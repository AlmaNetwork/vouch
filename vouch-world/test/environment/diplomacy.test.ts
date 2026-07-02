import { describe, expect, test } from "bun:test";
import { encodeBase64, issueCertificate, keyPairFromSeed } from "vouch-core";
import {
  admitAgent,
  admitTreasury,
  assessCertificate,
  createAlmaWorld,
  executeTransfer,
  experimenterProposal,
  INITIAL_WORLD_STATE,
  proposeFounding,
  recognizeRegion,
  rootReducer,
  seedGenesis,
} from "../../src/environment";
import { replayState } from "../../src/foundation";
import { defineRegion, type ForeignCertStance, getRegion, makeInstitutions } from "../../src/region";

const ISSUED_AT = "2026-06-22T00:00:00.000Z";
const GUILD = keyPairFromSeed(new Uint8Array(32).fill(11));
const NOTARY = keyPairFromSeed(new Uint8Array(32).fill(9));

// A world with an issuer "guild@umi" and a viewer village "yama" whose stance toward
// umi (and whether it locally accepts the cert's schema) are configurable.
function world(yamaStance: ForeignCertStance, yamaAcceptsSchema = false) {
  const w = createAlmaWorld("dip");
  seedGenesis(w, [
    defineRegion(
      "umi",
      "Umi",
      makeInstitutions({ verificationPolicy: { acceptedSchemaIds: ["alma.skill/v1"], rejectUnknownSchemas: false } }),
    ),
    defineRegion(
      "yama",
      "Yama",
      makeInstitutions({
        verificationPolicy: { acceptedSchemaIds: yamaAcceptsSchema ? ["alma.skill/v1"] : [], rejectUnknownSchemas: true },
        diplomacyPolicy: { defaultStance: yamaStance, overrides: {} },
      }),
    ),
  ]);
  admitAgent(w, { id: "guild@umi", region: "umi", role: "broker", valueProfile: "lenient", publicKey: encodeBase64(GUILD.publicKey) });
  const cert = issueCertificate(
    { issuer: "guild@umi", subject: "alice@yama", schemaId: "alma.skill/v1", claims: { skill: "smith", level: 5 }, issuedAt: ISSUED_AT },
    GUILD.privateKey,
  );
  return { w, cert };
}

describe("M4 — diplomacy: translating a foreign certificate (§4-A)", () => {
  test("absorb: the foreign cert is accepted as-is", () => {
    const { w, cert } = world("absorb");
    const a = assessCertificate(w.getState(), "yama", cert);
    expect(a).toMatchObject({ honored: true, stance: "absorb", mapped: false });
  });

  test("map: accepted, flagged as translated into the local vocabulary", () => {
    const { w, cert } = world("map");
    const a = assessCertificate(w.getState(), "yama", cert);
    expect(a).toMatchObject({ honored: true, stance: "map", mapped: true });
  });

  test("reject: not honored", () => {
    const { w, cert } = world("reject");
    expect(assessCertificate(w.getState(), "yama", cert).honored).toBe(false);
  });

  test("reexamine: honored only if the viewer's own policy accepts the schema", () => {
    expect(assessCertificate(world("reexamine", false).w.getState(), "yama", world("reexamine", false).cert).honored).toBe(false);
    const yes = world("reexamine", true);
    expect(assessCertificate(yes.w.getState(), "yama", yes.cert).honored).toBe(true);
  });

  test("a domestic cert is judged by the village's own verification policy", () => {
    const w = createAlmaWorld("dom");
    seedGenesis(w, [
      defineRegion(
        "umi",
        "Umi",
        makeInstitutions({ verificationPolicy: { acceptedSchemaIds: ["alma.skill/v1"], rejectUnknownSchemas: true } }),
      ),
    ]);
    admitAgent(w, { id: "guild@umi", region: "umi", role: "broker", valueProfile: "lenient", publicKey: encodeBase64(GUILD.publicKey) });
    const ok = issueCertificate(
      { issuer: "guild@umi", subject: "bob@umi", schemaId: "alma.skill/v1", claims: { skill: "x", level: 1 }, issuedAt: ISSUED_AT },
      GUILD.privateKey,
    );
    const no = issueCertificate(
      { issuer: "guild@umi", subject: "bob@umi", schemaId: "alma.unknown/v1", claims: {}, issuedAt: ISSUED_AT },
      GUILD.privateKey,
    );
    expect(assessCertificate(w.getState(), "umi", ok)).toMatchObject({ honored: true, stance: "domestic" });
    expect(assessCertificate(w.getState(), "umi", no)).toMatchObject({ honored: false, stance: "domestic" });
  });

  test("a form-invalid cert is never honored, whatever the stance", () => {
    const { w, cert } = world("absorb");
    const tampered = { ...cert, claims: { skill: "smith", level: 99 } };
    expect(assessCertificate(w.getState(), "yama", tampered)).toMatchObject({ honored: false, stance: "form-invalid" });
  });

  test("an unknown issuer is rejected", () => {
    const { w } = world("absorb");
    const stranger = keyPairFromSeed(new Uint8Array(32).fill(77));
    const cert = issueCertificate(
      { issuer: "ghost@umi", subject: "alice@yama", schemaId: "alma.skill/v1", claims: { skill: "x", level: 1 }, issuedAt: ISSUED_AT },
      stranger.privateKey,
    );
    expect(assessCertificate(w.getState(), "yama", cert)).toMatchObject({ honored: false, stance: "unknown-issuer" });
  });

  test("changing yama's stance changes whether the SAME cert is honored", () => {
    const yes = world("absorb");
    const nope = world("reject");
    expect(assessCertificate(yes.w.getState(), "yama", yes.cert).honored).toBe(true);
    expect(assessCertificate(nope.w.getState(), "yama", nope.cert).honored).toBe(false);
  });
});

describe("M4 — recognition flow (§4-C)", () => {
  function founded() {
    const w = createAlmaWorld("rec");
    seedGenesis(w, [defineRegion("umi", "Umi")]); // genesis -> recognized
    proposeFounding(w, experimenterProposal(defineRegion("nova", "Nova"))); // founded -> unrecognized
    return w;
  }

  test("a founded village is born unrecognized, then a recognized village admits it", () => {
    const w = founded();
    expect(getRegion(w.getState(), "nova")?.status).toBe("unrecognized");
    recognizeRegion(w, "umi", "nova");
    expect(getRegion(w.getState(), "nova")?.status).toBe("recognized");
  });

  test("an unrecognized village cannot recognize another", () => {
    const w = founded();
    proposeFounding(w, experimenterProposal(defineRegion("rift", "Rift")));
    expect(() => recognizeRegion(w, "nova", "rift")).toThrow(/unrecognized/); // nova is itself unrecognized
  });

  test("recognition is idempotent and replays from the log", () => {
    const w = founded();
    recognizeRegion(w, "umi", "nova");
    recognizeRegion(w, "umi", "nova"); // no-op
    expect(replayState(w.log.all(), INITIAL_WORLD_STATE, rootReducer).state).toEqual(w.getState());
  });
});

describe("M4 — cross-region trade is gated by diplomacy (§4-C, Test 2)", () => {
  function econ(yamaStanceTowardUmi: ForeignCertStance) {
    const w = createAlmaWorld("xr");
    seedGenesis(w, [
      defineRegion("umi", "Umi"),
      defineRegion("yama", "Yama", makeInstitutions({ diplomacyPolicy: { defaultStance: yamaStanceTowardUmi, overrides: {} } })),
    ]);
    admitTreasury(w, "umi");
    admitTreasury(w, "yama");
    admitAgent(w, { id: "alice@umi", region: "umi", role: "merchant", valueProfile: "lenient", publicKey: "", currency: 100 });
    admitAgent(w, { id: "bob@yama", region: "yama", role: "merchant", valueProfile: "lenient", publicKey: "", currency: 0 });
    return w;
  }

  test("settles when the receiving village does not reject the sender's", () => {
    const w = econ("absorb");
    expect(executeTransfer(w, { from: "alice@umi", to: "bob@yama", amount: 40 }, { tick: 0, notary: NOTARY }).ok).toBe(true);
  });

  test("blocked when the receiving village's policy rejects the sender's", () => {
    const w = econ("reject");
    const res = executeTransfer(w, { from: "alice@umi", to: "bob@yama", amount: 40 }, { tick: 0, notary: NOTARY });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("receiver-rejects-sender");
  });

  test("blocked to an unrecognized region, then enabled once recognized", () => {
    const w = econ("absorb");
    proposeFounding(w, experimenterProposal(defineRegion("nova", "Nova")));
    admitTreasury(w, "nova");
    admitAgent(w, { id: "carol@nova", region: "nova", role: "merchant", valueProfile: "lenient", publicKey: "", currency: 0 });

    const before = executeTransfer(w, { from: "alice@umi", to: "carol@nova", amount: 10 }, { tick: 0, notary: NOTARY });
    expect(before.ok).toBe(false);
    if (!before.ok) expect(before.reason).toBe("receiver-region-unrecognized");

    recognizeRegion(w, "umi", "nova");
    expect(executeTransfer(w, { from: "alice@umi", to: "carol@nova", amount: 10 }, { tick: 1, notary: NOTARY }).ok).toBe(true);
  });
});
