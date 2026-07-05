// Typed credentials — varied, validated certificate types on the universal
// vouch-core envelope (the "meaning" layer above the meaning-free core).

export {
  type CredentialFailureReason,
  type CredentialResult,
  type IssueCredentialInput,
  issueCredential,
  verifyCredential,
  verifyCredentialWith,
} from "./issue";
export {
  AssetCredential,
  EndorsementCredential,
  MembershipCredential,
  SkillCredential,
  STANDARD_CREDENTIALS,
  StewardCredential,
  standardRegistry,
} from "./library";
export { CredentialRegistry, type CredentialType, defineCredentialType } from "./types";
