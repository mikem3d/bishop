import { Image } from 'expo-image';

export type AvatarState = 'idle' | 'thinking' | 'working' | 'needs_you';

const SOURCES = {
  idle: require('../../assets/avatar/bishop_idle_256.png'),
  thinking: require('../../assets/avatar/bishop_thinking_256.png'),
  working: require('../../assets/avatar/bishop_working_256.png'),
  needs_you: require('../../assets/avatar/bishop_needs_you_256.png'),
};

const LABELS: Record<AvatarState, string> = {
  idle: 'Bishop, idle',
  thinking: 'Bishop, thinking',
  working: 'Bishop, agents working',
  needs_you: 'Bishop, needs you',
};

/** The pixel avatar. Sizes that divide 256 evenly (32, 64, 128) stay crispest. */
export function Avatar({ state, size = 64 }: { state: AvatarState; size?: number }) {
  return (
    <Image
      source={SOURCES[state]}
      style={{ width: size, height: size }}
      contentFit="contain"
      accessibilityLabel={LABELS[state]}
    />
  );
}

/** Which face to show for the current workload. */
export function avatarStateFor(counts: { needsYou: number; inFlight: number }): AvatarState {
  if (counts.needsYou > 0) return 'needs_you';
  if (counts.inFlight > 0) return 'working';
  return 'idle';
}
