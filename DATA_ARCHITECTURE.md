# Eventra data architecture

## Evidence classes

Eventra distinguishes three sources:

- `PLATFORM`: operational records created through Eventra after provenance support is available.
- `LEGACY_UNVERIFIED`: pre-provenance records. The original values are retained, but their origin cannot be inferred safely.
- `DEMO_SEED`: reproducible UI seed records. They are demonstration data, not real event observations.
- `IMPORTED_HISTORICAL_DATA`: rows accepted by CSV validation. They remain `IMPORTED_UNVERIFIED` until their source evidence is reviewed.
- `SYNTHETIC DEMONSTRATION DATA`: generated only in the isolated `ml/` experiment. It is never inserted into the operational database.

`events.legacy_registrations` remains an aggregate demand field. It is not an attendee list, check-in count, or attendance outcome.

## New persistence

`events` gains source, source reference, and data-quality status/notes. Existing pre-provenance rows receive `LEGACY_UNVERIFIED` metadata; event business values are not rewritten. New Eventra-created events are `PLATFORM`; newly seeded event rows are `DEMO_SEED`.

`event_snapshots` is append-only and records event fields, registration counts, check-ins, ticket-type counts, capture timestamp, source, and reason. Event create/edit, registration, cancellation, check-in, manual checkpoint, and scheduled checkpoint workflows can capture changes. A scheduled checkpoint runs every six hours while the API process is alive. Identical states are deduplicated.

`prediction_snapshots` records 30-day, 14-day, 7-day, and 1-day prediction points once each cutoff passes. Its feature payload is reconstructed from the newest `event_snapshots` record whose timestamp is at or before the cutoff. If none exists, the point is persisted unavailable with an explanation. Post-cutoff registrations, check-ins, edits, and outcomes are not used to fill an earlier point.

`event_outcomes` stores identified registration totals separately from check-ins. An operational event outcome is marked `VERIFIED` only when explicit `Completed` status, platform provenance, identified confirmed registrations, actual check-ins, and temporal consistency checks are present. Otherwise it is `OUTCOME_UNAVAILABLE`. This is conservative; it does not infer that missing check-in rows mean zero attendance.

Historical imports are stored in `historical_imports` and `historical_events`, separate from live events. A successful CSV parse means syntactic validation passed; it does not authenticate the external source or automatically make the row training-ready.

## Lifecycle and timestamps

The original status values and API behavior remain intact. Event responses add `temporalState`, derived from explicit cancellation/completion state and the event date. A past date with a non-completed status is surfaced as `PAST_STATUS_REVIEW`; the stored status is not silently changed.

All persisted capture timestamps are ISO-8601 UTC. Event date cutoffs use the event's date at `00:00:00Z` and the named lead time. The project currently has no stored event timezone, so this is a documented limitation.

## Access and data flow

`/api/data-intelligence` is authenticated and organizer-scoped; administrators receive platform-wide records. Historical import endpoints are admin-only. Snapshot timelines reuse `eventForUser` ownership checks. The current attendance estimate/readiness/risk engine remains separate from the experimental model lab.
