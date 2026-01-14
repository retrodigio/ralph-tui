/**
 * ABOUTME: Centralized rate limit state management across all workers.
 * Coordinates fallback between agents when rate limits are hit and manages
 * background recovery probes to detect when agents become available again.
 */

import { EventEmitter } from 'events';

/**
 * State of a single agent's rate limit status
 */
export interface AgentRateLimitState {
  /** Whether the agent is currently available or rate-limited */
  status: 'available' | 'limited';
  /** When the agent was marked as limited (null if available) */
  limitedAt: Date | null;
  /** When to retry the agent (null if unknown) */
  retryAfter: Date | null;
  /** Number of consecutive rate limit hits */
  consecutiveLimits: number;
}

/**
 * Events emitted by the RateLimitCoordinator
 */
export interface RateLimitCoordinatorEvents {
  /** Emitted when an agent becomes rate-limited */
  'agent:limited': (agent: string, state: AgentRateLimitState) => void;
  /** Emitted when an agent becomes available again */
  'agent:available': (agent: string) => void;
  /** Emitted when all agents are rate-limited */
  'all:limited': () => void;
  /** Emitted when at least one agent recovers from all-limited state */
  'all:recovered': (agent: string) => void;
}

/**
 * Typed EventEmitter for RateLimitCoordinator
 */
interface TypedEventEmitter {
  on<K extends keyof RateLimitCoordinatorEvents>(
    event: K,
    listener: RateLimitCoordinatorEvents[K]
  ): this;
  off<K extends keyof RateLimitCoordinatorEvents>(
    event: K,
    listener: RateLimitCoordinatorEvents[K]
  ): this;
  emit<K extends keyof RateLimitCoordinatorEvents>(
    event: K,
    ...args: Parameters<RateLimitCoordinatorEvents[K]>
  ): boolean;
  removeAllListeners(event?: keyof RateLimitCoordinatorEvents): this;
}

/**
 * RateLimitCoordinator manages rate limit state across all workers in the pool.
 *
 * Key responsibilities:
 * - Track which agents are rate-limited vs available
 * - Provide fallback agent selection when current agent is limited
 * - Run background recovery probes to detect when agents recover
 * - Emit events for pool-level coordination (e.g., stop spawning workers)
 */
export class RateLimitCoordinator
  extends EventEmitter
  implements TypedEventEmitter
{
  /** Per-agent rate limit state */
  private agents: Map<string, AgentRateLimitState> = new Map();

  /** Ordered list of agents for fallback (first = primary) */
  private fallbackChain: string[];

  /** Recovery probe interval handle */
  private probeInterval: ReturnType<typeof setInterval> | null = null;

  /** Whether all agents were limited (for detecting recovery) */
  private wasAllLimited = false;

  /**
   * Create a new RateLimitCoordinator
   *
   * @param fallbackChain - Ordered list of agent IDs (first = primary, last = fallback)
   */
  constructor(fallbackChain: string[] = ['claude', 'opencode']) {
    super();
    this.fallbackChain = fallbackChain;

    // Initialize all agents as available
    for (const agent of fallbackChain) {
      this.agents.set(agent, {
        status: 'available',
        limitedAt: null,
        retryAfter: null,
        consecutiveLimits: 0,
      });
    }
  }

  /**
   * Mark an agent as rate-limited.
   * Called by workers when they detect a rate limit from the agent.
   *
   * @param agent - Agent identifier (e.g., 'claude', 'opencode')
   * @param retryAfter - Optional Date when the agent should be retried
   */
  markLimited(agent: string, retryAfter?: Date): void {
    let state = this.agents.get(agent);

    if (!state) {
      // Unknown agent - add it to tracking
      state = {
        status: 'available',
        limitedAt: null,
        retryAfter: null,
        consecutiveLimits: 0,
      };
      this.agents.set(agent, state);
    }

    const now = new Date();
    const wasAvailable = state.status === 'available';

    state.status = 'limited';
    state.limitedAt = now;
    state.retryAfter = retryAfter ?? null;
    state.consecutiveLimits++;

    if (wasAvailable) {
      this.emit('agent:limited', agent, { ...state });

      // Check if all agents are now limited
      if (this.allAgentsLimited()) {
        this.wasAllLimited = true;
        this.emit('all:limited');
      }
    }
  }

  /**
   * Mark an agent as available.
   * Called by recovery probes or when an agent successfully completes work.
   *
   * @param agent - Agent identifier
   */
  markAvailable(agent: string): void {
    let state = this.agents.get(agent);

    if (!state) {
      // Unknown agent - add it as available
      state = {
        status: 'available',
        limitedAt: null,
        retryAfter: null,
        consecutiveLimits: 0,
      };
      this.agents.set(agent, state);
      return;
    }

    if (state.status === 'limited') {
      state.status = 'available';
      state.limitedAt = null;
      state.retryAfter = null;
      state.consecutiveLimits = 0;

      this.emit('agent:available', agent);

      // Check if we recovered from all-limited state
      if (this.wasAllLimited) {
        this.wasAllLimited = false;
        this.emit('all:recovered', agent);
      }
    }
  }

  /**
   * Get the next available agent in the fallback chain.
   * Skips the current agent and any that are rate-limited.
   *
   * @param currentAgent - The currently used agent to skip
   * @returns The next available agent ID, or null if all are limited
   */
  getAvailableFallback(currentAgent: string): string | null {
    // Find agents after the current one in the chain
    const currentIndex = this.fallbackChain.indexOf(currentAgent);

    // First, check agents after the current one
    for (let i = currentIndex + 1; i < this.fallbackChain.length; i++) {
      const agent = this.fallbackChain[i];
      const state = this.agents.get(agent);
      if (!state || state.status === 'available') {
        return agent;
      }
    }

    // Then wrap around and check agents before the current one
    for (let i = 0; i < currentIndex; i++) {
      const agent = this.fallbackChain[i];
      const state = this.agents.get(agent);
      if (!state || state.status === 'available') {
        return agent;
      }
    }

    return null;
  }

  /**
   * Get the first available agent in the fallback chain.
   *
   * @returns The first available agent ID, or null if all are limited
   */
  getFirstAvailable(): string | null {
    for (const agent of this.fallbackChain) {
      const state = this.agents.get(agent);
      if (!state || state.status === 'available') {
        return agent;
      }
    }
    return null;
  }

  /**
   * Check if all agents in the fallback chain are currently rate-limited.
   *
   * @returns true if all agents are limited, false otherwise
   */
  allAgentsLimited(): boolean {
    for (const agent of this.fallbackChain) {
      const state = this.agents.get(agent);
      if (!state || state.status === 'available') {
        return false;
      }
    }
    return true;
  }

  /**
   * Get the current state of an agent.
   *
   * @param agent - Agent identifier
   * @returns The agent's rate limit state, or undefined if not tracked
   */
  getAgentState(agent: string): Readonly<AgentRateLimitState> | undefined {
    const state = this.agents.get(agent);
    return state ? { ...state } : undefined;
  }

  /**
   * Get all agent states.
   *
   * @returns Map of agent IDs to their rate limit states
   */
  getAllAgentStates(): Map<string, Readonly<AgentRateLimitState>> {
    const result = new Map<string, Readonly<AgentRateLimitState>>();
    for (const [agent, state] of this.agents) {
      result.set(agent, { ...state });
    }
    return result;
  }

  /**
   * Start a background recovery probe that periodically checks
   * if rate-limited agents have recovered.
   *
   * The probe checks if the retryAfter time has passed and marks
   * agents as potentially available. Actual confirmation happens
   * when a worker successfully uses the agent.
   *
   * @param intervalMs - How often to run the probe (default: 30000ms)
   */
  startRecoveryProbe(intervalMs: number = 30000): void {
    // Stop any existing probe
    this.stopRecoveryProbe();

    this.probeInterval = setInterval(() => {
      this.runRecoveryCheck();
    }, intervalMs);
  }

  /**
   * Stop the background recovery probe.
   */
  stopRecoveryProbe(): void {
    if (this.probeInterval) {
      clearInterval(this.probeInterval);
      this.probeInterval = null;
    }
  }

  /**
   * Run a single recovery check.
   * Marks agents as available if their retryAfter time has passed.
   */
  private runRecoveryCheck(): void {
    const now = new Date();

    for (const [agent, state] of this.agents) {
      if (state.status === 'limited' && state.retryAfter) {
        if (state.retryAfter <= now) {
          // Retry time has passed - mark as available
          this.markAvailable(agent);
        }
      }
    }
  }

  /**
   * Get the fallback chain.
   *
   * @returns Copy of the fallback chain array
   */
  getFallbackChain(): string[] {
    return [...this.fallbackChain];
  }

  /**
   * Check if the recovery probe is running.
   *
   * @returns true if the probe is active
   */
  isProbeRunning(): boolean {
    return this.probeInterval !== null;
  }

  /**
   * Clean up resources.
   */
  dispose(): void {
    this.stopRecoveryProbe();
    this.removeAllListeners();
  }
}
