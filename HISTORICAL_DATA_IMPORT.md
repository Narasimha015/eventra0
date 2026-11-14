# Historical event CSV import

Historical data import is available to administrators at **Admin → Data Intelligence**. CSV content is validated before any write; preview reports valid and rejected rows and row-level reasons. Confirmation revalidates on the server, detects duplicates within the file and against previously imported records, records import metadata, and stores accepted rows separately from live events.

Required headers:

```csv
title,date,category,capacity,venue_capacity,registrations,confirmed_registrations,cancellations,actual_check_ins,source_reference
```

`title`, `date` (strict `YYYY-MM-DD`), `capacity`, `registrations`, `confirmed_registrations`, `cancellations`, and `actual_check_ins` are required. `category`, `venue_capacity`, and row-level `source_reference` are optional. A report/archive identifier may also be entered at import time. Capacity and counts must be non-negative integers (capacity positive); check-ins cannot exceed confirmed registrations; confirmed plus cancelled cannot exceed total registrations.

Rows are labeled `SOURCE: IMPORTED HISTORICAL DATA` and stored `IMPORTED_UNVERIFIED`. CSV validation checks shape and internal consistency, not whether a source document is genuine. After inspecting the source, an administrator can attest to the evidence reference and review notes; Eventra stores reviewer and timestamp and marks the row `VERIFIED`. This is a human provenance review, not independent source authentication. Rejected rows remain visible in the preview and import summary; the UI never silently reports them as imported.

The upload is read in the browser and sent as JSON text, capped at 2 MB. No package or external service is required.
