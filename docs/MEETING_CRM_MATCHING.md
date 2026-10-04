# Meeting ↔ CRM matching (0.4.0)

## Scope and generation

The engine consumes only the synchronized current-manager amoCRM cache. There is no network access or external AI in `electron/matching`. Active cached lead relations determine which contacts and companies are eligible. Closed deals remain manually selectable; an explicit known closed deal mention can propose that deal without an active-deal bonus. A matched contact/company without an active deal may produce a client-only proposal.

`MatchingIndex` builds maps for complete email/phone, token anchors for names, normalized known phrases, entity-to-deal and client-to-deal relations. Participants narrow contact candidates using identifiers and shared name tokens. Title, every available source retelling and transcript segments look up known phrase anchors. Only hit entities are enriched and ranked. No meeting × every CRM entity × every transcript segment scan is used. The index is rebuilt once per recalculation batch; the current cache, not a remote search infrastructure, remains authoritative.

## Normalization

- Lowercase Russian text, collapse whitespace/punctuation, ё → е. Original display strings remain intact.
- Company legal forms ООО, ИП, АО, ПАО and quotation marks are removed for comparison. Exact token boundaries are required. No grammatical inflection or transliteration is guessed.
- Email: trim, lowercase, validate complete email, exact equality across all EMAIL values.
- Phone: complete 10–15 digits, formatting punctuation removed; Russian 11-digit 8 prefix → 7. Extensions and short/partial numbers are rejected. There is no substring comparison.
- Person: at least two name tokens; matching two full words supports order differences and first/last within a full name. Shared full word plus a compatible initial is weaker. A shared full word and one limited typo in another word is weak. A single first name never matches. Foreign-system user IDs are not treated as cross-system identity.
- Generic company words (Сервис, Технологии, Групп, etc.) and generic deal/title values receive at most a weak text signal. Generic meeting titles provide no title evidence.

## Deterministic score

| Signal | Weight |
|---|---:|
| Participant exact email or complete phone | 90 |
| Company in title | 65 |
| Known deal in title | 75 |
| Full participant name / initials / limited typo | 40 / 20 / 15 |
| Contact name in title/retelling/transcript | 20 |
| Company in retelling / transcript | 35 / 30 |
| Deal in retelling / transcript | 65 / 55 |
| Active deal / only active deal for client | 3 / 6 |
| Generic company/deal text | 10 |

The maximum weight per semantic signal is used; all company text sources share one scoring signal, as do all deal text sources. The same email/phone identity is not added twice. Evidence of the same type/entity is retained once even if repeated across recordings/retellings. Repeated quotations do not inflate confidence. Scores are bounded to 0–100; stable candidate keys break ties deterministically.

High: score ≥80 plus a strong source signal; medium: score ≥40; otherwise low. When a client has multiple active deals and there is no explicit deal mention, overall/deal confidence is capped at medium (69). Client confidence is calculated separately from client/contact evidence. A matched person does not silently choose a deal. No proposal, including a high-confidence one, confirms itself.

Distinct unrelated strong identities/company/deal signals require review and cap the score at 39. A distinctive company mention in source text conflicting with an exact participant email/phone also requires review. Weak activity/context cannot overcome these contradictions. Recent-activity/date heuristics are intentionally not used without a verified useful signal.

## Evidence

`MatchEvidence` stores type, strength, source, sourceRecordId, transcriptSegmentId, timestampMs and a generic Russian explanation. It stores no quoted transcript copies. Types include participant_email_exact, participant_phone_exact, participant_name_match, company_name_in_title/retelling/transcript, contact_name_in_*, deal_name_in_*, active_deal, only_active_deal, conflicting_identity.

Transcript reasons open the bounded local page containing the existing segment ID and highlight it. When source refresh removes a referenced segment, a clear message directs the user to local text search. All recordings inherit their logical meeting's relationship.

## Confirmation and persistence

Migration 005 adds `meeting_crm_links`, indexes by client/deal, `meeting_crm_link_history` and optional participant phone. Relationships are independent of the old meetings client/deal columns. Confirmed JSON retains display labels for an unavailable CRM cache record; candidate JSON contains only bounded evidence references. Snapshot client/deal IDs project only the confirmed mapping, including confirmed mappings needing review. Source summaries have a bounded 280-character preview for client workspace.

Statuses: unlinked, proposed, confirmed, needs_review. Confirmation validates the selected client/deal/contact against the active cached CRM scope, stores current authorized CRM user, timestamp, manual/candidate method and previous candidate score. Selecting a client without a deal is supported. Native IPC only accepts the main application frame and a meeting belonging to the active Kontur account. Stale or inconsistent candidate selection is rejected.

Missing, deleted or unavailable contacts are excluded from proposal and manual default contact selection. A company can be confirmed without a contact. Company workspace availability remains active while any associated scoped deal is available; an unavailable historical deal cannot hide an available company. Loss of access to a confirmed contact raises a warning and preserves the confirmed identity.

Manual reassignment replaces the local authoritative mapping and records prior state. Unlink requires a UI confirmation and records prior state in history; meeting, source artifacts and CRM entities remain. The user can select and confirm another relationship later.

Startup and committed source/CRM refresh recalculate proposals locally. Explicit batch search processes only unconfirmed meetings. Confirmed identity is never replaced by analysis. Strong conflicting evidence or unavailable CRM selection produces a warning while retaining that identity. If late conference IDs merge two recordings, a confirmed mapping transfers to the surviving logical meeting. Different confirmed mappings produce a retained warning and history entry instead of silently discarding the second choice.

## Limits and next phase

These are lexical proposals, not factual claims about conversation roles. No AI, CRM writes, source mutations, admin-only requests or automatic confirmation is implemented. Kontur participants in the real sample have no exposed phones: phone support is tested for source data that actually provides a complete number. A name-only or no-match meeting needs human selection. Future structured extraction can consume the confirmed logical meeting → client → optional deal association and evidence references; it must require a deal where its workflow needs one.
