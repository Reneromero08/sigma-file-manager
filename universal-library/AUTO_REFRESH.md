# Universal Library automatic refresh

Automatic catalog refresh is an explicit opt-in extension feature.

## Defaults

- Disabled on first install and after missing configuration.
- Default interval when enabled: 30 minutes.
- Allowed interval range: 5 minutes through 24 hours.
- First scheduled refresh starts after a short startup delay.

## Execution contract

- Approved library roots are scanned sequentially.
- Only one automatic or manual automatic-refresh run may execute at a time.
- A second request while a run is active returns an `already-running` result.
- Each root failure is isolated so other approved roots can continue.
- Source files are read for indexing only. They are never moved, copied, renamed, or rewritten.
- Existing catalog reconciliation rules remain authoritative for offline and missing locations.

## Persisted state

The extension stores:

- whether automatic refresh is enabled;
- the selected interval;
- last start and completion timestamps;
- next scheduled run timestamp;
- last scan summary;
- last error.

## Commands

- `Universal Library: Configure automatic refresh`
- `Universal Library: Run automatic refresh now`
- `Universal Library: Show automatic refresh status`

The controller cancels its timer when the extension deactivates. Timers are recreated from persisted configuration on the next activation.
