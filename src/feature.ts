import type { OpenAILiveError } from './errors'
import type { SwitchboardClient } from './SwitchboardClient'
import type { OpenAILiveToolkitTool } from './OpenAILiveToolkit'

/**
 * A part of the toolkit an app turns on, such as media: what it adds to the graph, the events of
 * its nodes, and what it does as the engine, the session and the network change. Internal for now.
 */
export interface ToolkitFeature {
  /** What it adds to a new engine's graph, or null for nothing. `voice` taps the model's voice. */
  graph(voice: string): FeatureGraph | null
  /**
   * Its condition for the tools note's "Delegate to the backend when" list, given the registered
   * tools, or null for none.
   */
  toolsNote(tools: readonly { name: string }[]): string | null
  /** Whether events from the graph node `nodeId` are its own. */
  ownsNode(nodeId: string): boolean
  /** An event from one of its nodes. */
  handleNodeEvent(nodeId: string, name: string, data: unknown): void
  /** A session came up. `forked` when it forks the one before, so it holds what that one was told. */
  sessionStarted(forked: boolean): void
  /** The engine's state changed (iOS): `'interrupted'` by another app's audio, `'running'` again. */
  engineStateChanged(state: string | undefined, reason: string | undefined): void
  /** The engine stopped. */
  engineStopped(): void
  /** The network is back while the engine runs. */
  networkBack(): void
  /**
   * The device starts or stops speaking an offline notice, next to the model's voice. A notice that
   * cuts off the one playing sends `true` again, with no `false` between.
   */
  noticeSpeaking(speaking: boolean): void
  /** The user starts or stops speaking, from the voice activity detector. Never while muted. */
  userSpeaking(speaking: boolean): void
  /** Another app is about to play: stop what keeps other apps' audio out. */
  makeWayForOtherAudio(): void
}

/** Nodes and connections a feature adds to the graph. */
export interface FeatureGraph {
  nodes: object[]
  connections: object[]
  /** Its nodes that play into the mixer, next to the model's voice. */
  mixerInputs: string[]
  /** Whether it follows the user's speech, which adds the voice activity detector. */
  userSpeech?: boolean
}

/** What the toolkit offers a feature. */
export interface FeatureHost {
  client(): SwitchboardClient | null
  /** The engine, which exists from the first start until release. */
  engineId(): string | null
  isRunning(): boolean
  isSessionLive(): boolean
  /** The network is gone, or the user was told the connection is. Only known with `offlineNotice`. */
  isOffline(): boolean
  /** Quiet context for the session that's up. */
  addContext(text: string): boolean
  /** Change the registered tools, then send the delegate the result once. */
  updateTools(update: (tools: Map<string, OpenAILiveToolkitTool>) => void): void
  /**
   * iOS: keep other apps' audio from playing, which turns the engine's mixWithOthers off, or let it
   * play again. Only with mixWithOthers.
   */
  keepOtherAudioOut(keep: boolean): void
  /** Whether other apps' audio is kept out now. */
  isOtherAudioKeptOut(): boolean
  voiceVolume(): number
  /** Whether audio plays on the phone's loudspeaker, where the microphone hears it. */
  isOnSpeaker(): boolean
  reportError(error: OpenAILiveError): void
}
