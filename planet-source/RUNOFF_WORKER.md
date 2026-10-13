# Rainfall calculation and cancellation

The settlement rain page runs canonical world restoration, terrain sampling and
minute-by-minute runoff calculations in one module Worker. Rendering and controls
remain on the UI thread. There is at most one outstanding job, a 120-second timeout,
and a single Worker. Each job advances at most 60 simulated seconds; the normal
button still performs ten such jobs. No model or saved-world definitions change.

Stopping terminates the Worker, rejects the pending request and preserves the last
fully completed state. A later run creates a new Worker and resumes from that state.
Old replies are ignored by Worker identity and request ID. Cancelled or failed resets
restore the controls to the retained state's settlement and model options. Leaving
the page aborts the input download and terminates any calculation.

Node verification checks exact equality to direct Core calculations, immutable input,
real saved-world initialization/identity, overlapping requests, cancellation, stale
replies, timeout, Worker failure and retry. These checks do not themselves constitute
browser cancellation or responsiveness acceptance. Browser verification follows the
currently running, source-frozen 30-minute globe test.

## Actual browser check, 2026-10-10

Cloud Chromium opened the same @15 world as the globe. Starting then stopping
terminated the calculation and kept a completed 0-second checkpoint; an earlier
try retained 60 seconds. Resuming completed 600 additional seconds (respectively
600/660 total). The 600-second water volume differed from the Node Core run by
3.46e-8 m³, with step water balance error 2.53e-11 m³. Disabling drainage reset to
0 seconds, preserved the world ID and removed all four active pipe connections.
Elapsed time is displayed on cancellation; starting again immediately says it is
calculating. Evidence: examples/planet/verification/browser-rain-interrupt-resume.json.
The final whole suite remains 503 pass / 0 fail and build verification passes.
