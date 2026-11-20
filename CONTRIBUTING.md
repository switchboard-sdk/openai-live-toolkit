# Contributing

## Development

```sh
npm run build       # tsc → dist/ (JS + .d.ts); also runs on npm pack via prepare
npm run typecheck   # tsc --noEmit
npm run lint        # ESLint (src)
npm run format      # Prettier
```

`main`/`types` resolve to the built `dist/`; `react-native`/`source` resolve to
`src/` so Metro uses the TypeScript directly (no prebuild needed in dev).

### Running the example app

See [`example/README.md`](example/README.md) for the full setup. Note that it needs
**Ruby 3.1+** — `example/Gemfile.lock` is resolved with Ruby 3.4 / Bundler 2.6.9, and
the Ruby that ships with macOS is 2.6.

### Testing against a real consumer app

[`example/`](example) depends on the checkout directly (`file:..`), so it picks up
`src/` changes with no extra step. To test a *separate* app the way a user would
install the package, pack a tarball:

```sh
npm install     # must come first: `npm pack` runs `prepare` → `tsc`, so without the
                # devDependencies it fails with "tsc: command not found" (npm code 127)
npm pack        # → synervoz-openai-live-toolkit-0.1.0.tgz

cd /path/to/that-app
npm install /path/to/openai-live-toolkit/synervoz-openai-live-toolkit-0.1.0.tgz
```

Install the tarball, not `file:../openai-live-toolkit` — a symlinked package
breaks Metro resolution and duplicates React. The tarball is a snapshot, so re-pack
and re-install after every change, or the app keeps building against the old API.

CI does the same on every PR and nightly: [`build.yml`](.github/workflows/build.yml)
packs the toolkit and builds the example app against the tarball for Android and iOS,
from scratch with no caches.

## Tests

Run the unit suite with:

```sh
npm test
```

`npm run test:cov` runs the same suite and enforces the coverage thresholds in
`jest.config.js` — this is what CI runs (see
[`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

The suite checks the node events it fakes against the Switchboard SDK's schema, so they
match what the SDK sends. Download it with `npm run sdk:schema`, which takes
`SWITCHBOARD_BUILD` as `pod install` does. Without it the check is skipped, except in CI.
`emitUncheckedEvent` fakes an event the SDK doesn't send, such as one from a node the graph
doesn't have.

### iOS native code

The XCTest suite in [`ios/Tests`](ios/Tests) covers Now Playing, ducking the Music
app, audio routes and the C++ module's platform hooks. Run it on a simulator with:

```sh
npm run test:ios    # IOS_SIMULATOR=<name or UDID> picks the simulator
```

It needs only Xcode: the test project builds the code under test without React Native
or the Switchboard frameworks, so that code lives in units of its own rather than in
`OpenAILiveToolkitModuleProvider.mm` or `NativeOpenAILiveToolkit.cpp`. Add new tests and
units to `ios/Tests/OpenAILiveToolkitTests.xcodeproj`, which also runs them from Xcode.
CI runs the suite too.

## Release

The package isn't published to npm yet. Versions follow [Semantic Versioning](https://semver.org/).

1. Update [`CHANGELOG.md`](CHANGELOG.md): move the `[Unreleased]` entries under a new version heading with the release date.
2. Bump the version (this also creates the git tag) and push both:

```sh
npm version patch   # or minor / major
git push && git push --tags
```

Consumers install from a tarball built with `npm pack` at that tag.
