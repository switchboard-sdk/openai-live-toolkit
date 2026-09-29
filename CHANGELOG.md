# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- `OpenAILiveToolkitProvider`, `useOpenAILiveToolkit` and `useTool` for full-duplex GPT-Live voice agents on iOS.
- Optional Quail speaker isolation, switchable at runtime. Linked with `OPENAI_LIVE_AICOUSTICS=1` at `pod install`.
- Tools through Responses delegation.
- A grouped live transcript of both speakers.
- Context actions: `appendInstructions`, `addContext`, `say`.
- Example app with a transcript, isolation toggle, mute and two tools.
