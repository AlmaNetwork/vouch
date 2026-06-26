// Typed credentials — varied, validated certificate types on the universal
// vouch-core envelope (the "meaning" layer above the meaning-free core).

export { type CredentialType, CredentialRegistry, defineCredentialType } from "./types";
export {
  type IssueCredentialInput,
  type CredentialResult,
  type CredentialFailureReason,
  issueCredential,
  verifyCredential,
  verifyCredentialWith,
} from "./issue";
export {
  SkillCredential,
  MembershipCredential,
  AssetCredential,
  EndorsementCredential,
  STANDARD_CREDENTIALS,
  standardRegistry,
} from "./library";
