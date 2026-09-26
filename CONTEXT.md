# AI Interview Platform

An assessment product: an assessor defines the skills a role needs, invites candidates, and each candidate answers voice prompts in an interview that produces a per-skill portfolio the assessor reviews.

## Language

**Assessment**:
A set of skills, each carrying its own expected level, that a candidate is interviewed against under one time limit. The unit an assessor owns and invites candidates to.
_Avoid_: Job, vacancy, position, form

**Session**:
One candidate's interview against one Assessment, tracked from waiting, through live, to an end reason. A candidate is invited by having a Session created for them.
_Avoid_: Interview run, attempt, application

**Invite**:
The single-use link that admits one candidate to their Session. Minting an invite is what creates a Session — the Session exists, waiting, from the moment the link exists.
_Avoid_: Link, token, request

**Session state**:
The lifecycle of a Session, and only ever one of three: awaiting candidate, live, or ended. "Ended" alone does not say how it ended; that is the end reason's job.
_Avoid_: Session status (see Assessment status), phase, stage

**End reason**:
Why a Session stopped: the candidate ended it, the assessor ended it, the skills were covered, the time ceiling was reached, or the platform erred. Kept separately from the state, and correctable — a Session that errored may later be ended cleanly.
_Avoid_: Outcome, termination reason, result

**Failed session**:
A Session that has ended with the error end reason. A presentation of a state plus a reason, never a fourth state — the API's status enumeration includes a failed value that nothing ever writes, so it must not be modelled, read, or displayed as one.
_Avoid_: Errored session, crashed session, failed state

**Assessment status**:
A per-skill judgment within one candidate's portfolio: assessed, not assessed, or needing review. A judgment about evidence, not about a Session's lifecycle — which is why it must not be conflated with Session state, despite both being called "status" in the type layer.
_Avoid_: Skill status, session status, result

**Portfolio**:
The per-skill record of what a completed Session found: a level, a confidence, and the evidence behind them, which the assessor can override.
_Avoid_: Report, result, transcript
