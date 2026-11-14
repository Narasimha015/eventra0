# Eventra Event Intelligence Engine

## Purpose and data flow

The intelligence feature turns persisted Eventra operations into an explainable organizer workflow:

```text
SQLite event, venue, registration and check-in rows
        ↓
Scoped aggregate queries (organizer ownership is enforced)
        ↓
Readiness score + attendance estimate + capacity risk
        ↓
Evidence-linked recommendations and what-if calculation
        ↓
Organizer may update event capacity through the existing event API
        ↓
Re-fetch and recalculate from the saved event record
```

The service is a deterministic statistical/rule-based engine, not a trained ML model. It calculates on request; it stores no snapshots and adds no database tables. It does not use random values or client-supplied organizer identity.

## Input variables

| Input | Source | Use |
| --- | --- | --- |
| Event limit, status, date, times and venue text | `events` | Capacity, schedule and event context |
| Linked venue capacity and status | `venues` via `events.venue_id` | Venue headroom and effective capacity |
| Confirmed and cancelled registrations | `registrations` | Current audience, cancellation rate and demand |
| Registration timestamps | `registrations.created_at` | Per-event daily registration trend |
| Check-in records and timestamps | `check_ins` | Actual attendance evidence, check-in trend and optional arrival concentration |
| Legacy aggregate registrations | `events.legacy_registrations` | Current event registered total and capacity pressure only |

The current schema has no per-event vendor assignment, staffing plan, gate count, session schedule, or historical reason for cancellation. These are not inferred or fabricated. Legacy aggregate registrations have no attendee or check-in identities, so they cannot contribute to historical attendance rates.

## Attendance estimate

For each organizer, historical observations include events marked `Completed` or with a date before SQLite's current date, excluding the selected event. Only identified confirmed registrations and their actual check-ins count.

When at least **two past events and 20 identified registrations** are available:

```text
historical attendance rate = historical checked-in registrations / historical confirmed registrations
point estimate = current registered total × historical attendance rate
```

The displayed interval uses the 95% Wilson interval for the observed binomial check-in proportion, multiplied by the current registered total. Wilson intervals behave better than a simple normal interval for small samples and rates near 0 or 1. They still represent sampling uncertainty only; they do not account for changes in audience, weather, event type, or other unrecorded causes.

When the minimum history is not met, Eventra labels the result **Rule-based estimate / Early estimate — insufficient historical data** and uses a disclosed planning baseline of 72%, with a range of 57%–87% (±15 percentage points). This fallback is a planning assumption, not a learned or scientifically calibrated estimate. It is deliberately visible so a demonstration does not imply unsupported accuracy.

## Readiness score

Each dimension is scored from 0 to 100 and combined with fixed weights:

| Dimension | Weight | Formula / evidence |
| --- | ---: | --- |
| Registration readiness | 25% | If no registrations, 25. Otherwise `clamp(65 + min(35, registered / event limit × 35) - cancellation rate × 50, 0, 100)`. Cancellation rate uses recorded confirmed plus cancelled registrations. |
| Capacity headroom | 25% | Let load = estimated attendance / effective capacity. At load ≤70%, score 100. Otherwise `clamp(100 - (load - 0.70) × 220, 0, 100)`. Effective capacity uses linked venue capacity; if none exists, event capacity is the stated proxy. |
| Check-in preparedness | 15% | With sufficient historical observations: `clamp(55 + historical registrations / 100 × 45, 55, 100)`. Without them, neutral evidence score 55. It measures history coverage, not staffing. |
| Venue readiness | 20% | 25 if no venue text, 55 if only free text exists, 45 if a linked venue is `UNAVAILABLE`; otherwise 100 when estimated attendance fits linked venue capacity, declining by the proportional shortfall when it does not. A linked `RESERVED` venue is treated as held for the event record. |
| Schedule readiness | 15% | 60 points when a start time exists (35 otherwise), +20 when an end time exists, +20 for `Upcoming`, `Live`, or `Completed` status. |

```text
readiness = round(sum(dimension score × dimension weight) / 100)
GOOD: 80–100 | NEEDS ATTENTION: 60–79 | AT RISK: 0–59
```

Every dimension returns its numeric score and the current records used to explain it. This score is an operational checklist signal; it is not a probability of success or a safety certification.

## Crowd risk and recommendations

Effective crowd capacity is linked venue capacity, falling back to the event limit when the venue is not linked. The engine computes registration load and estimated attendance load.

- **HIGH** if either load is at least 90%.
- **MEDIUM** if either load is at least 75% and neither reaches 90%.
- **LOW** otherwise.
- Arrival concentration can elevate risk to HIGH only with at least 10 event-specific check-ins and at least 60% of those records within the 60 minutes before the event start time. No gate-specific inference is made.

Recommendations are deterministic rules over the same event metrics: registration at/above 85% of event capacity, crowd risk, missing or unlinked venue information, missing schedule times, cancellation rate at/above 10%, and insufficient historical samples. Each includes the detected condition, why it matters, an action, and priority. A low-priority insufficient-history recommendation communicates uncertainty; it does not pretend that missing data is a detected operational fault.

## What-if analysis and action

`POST /api/events/:id/what-if` accepts a non-negative integer `expectedRegistrations` from 0 to 1,000,000. It scales the current point attendance rate and interval, then recalculates event-limit and venue-load risk. It does not write any data.

The dashboard's **Adjust event capacity** form is a separate action: it uses the existing authenticated event PATCH endpoint and then reloads the saved event's intelligence. The API rejects a new limit below current registrations or above a linked venue's capacity. A free-text venue still cannot be independently capacity-verified.

## Endpoints and authorization

- `GET /api/events/:id/intelligence` — administrator or authorized organizer; returns event data, scores, prediction, crowd risk, recommendations, trends, methodology and limitations.
- `POST /api/events/:id/what-if` — administrator or authorized organizer; body `{ "expectedRegistrations": 950 }`; read-only scenario response.

Existing authentication middleware checks the HTTP-only session/JWT. Organizers are scoped through `eventForUser`; another organizer's event returns the existing not-found behavior. Attendees receive 403. Event IDs and scenario inputs are validated with Zod. Queries use prepared SQLite statements and aggregate/group queries rather than per-registration N+1 reads.

## Demonstration sequence

1. Sign in as `organizer@eventra.local` using the local demo password from `README.md`.
2. Open **Event Intelligence** and select an event. Point out the readiness dimensions and their expandable explanations.
3. Show the attendance range. The bundled data contains legacy aggregate counts without attendee-level check-in history, so it correctly shows the disclosed early estimate instead of claiming a calibrated model.
4. Enter a projected registration count above the event limit. Show projected attendance, range, risk transition, and the warning. This calculation is read-only.
5. Review recommendations and their detected evidence.
6. If demonstrating a saved action, adjust event capacity only within the linked venue limit. The dashboard saves through the existing event API and refreshes its scores from SQLite. Use a demo database copy or restore the original limit after the presentation.
7. In an API test or a seeded environment with at least two completed events and 20 identified registrations/check-ins, show how the engine switches to a historical rate and Wilson interval.

## Validation and limitations

Backend unit tests cover Wilson intervals, readiness weights, history sufficiency, crowd risk, arrival evidence, recommendations, empty data, and what-if behavior. API tests cover role restrictions, ownership, event-ID/body validation, administrator access and non-mutating what-if requests. The current demo database is not an adequate labeled historical dataset for predictive validation; the fallback is for transparent demonstration only. A larger future study should collect more completed events, evaluate calibration on holdout events, compare against a naïve baseline, and report error intervals before making accuracy claims.

Future ML work would require consent-aware data collection, a materially larger representative dataset, leakage-safe temporal validation, baseline comparison, calibration/error reporting, monitoring for drift, and a documented model governance process. It should not be presented as machine learning until those steps are justified.
