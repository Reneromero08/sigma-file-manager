# Audio waveform workspace

Universal Library enriches indexed audio assets with durable analysis records produced by `ulib 0.2.0`.

The live workspace loads audio metadata by durable asset ID and renders symmetric SVG peak waveforms in asset cards and the inspector. Card metadata shows duration and sample rate; the inspector additionally shows channels, absolute peak, and RMS amplitude.

Audio analysis remains explicit:

- **Analyze audio** on the selected asset creates or refreshes one record;
- the toolbar **Analyze audio** action processes a bounded batch of online audio assets missing analysis;
- older custom `ulib` binaries remain usable, but return an empty audio-analysis set until upgraded;
- ordered mixed-media collections reuse the same asset-ID analysis map, so waveforms remain visible inside collections.

The embedded workspace never opens audio files directly. It calls structured same-extension commands, and `ulib` reads source audio without modifying it. Playback will use a separate secure local-media bridge rather than granting the embedded page arbitrary filesystem access.
