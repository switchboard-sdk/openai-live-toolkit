// Building blocks shared by the screens.

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors } from './colors';

export function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionHeader}>{title}</Text>
      {children}
    </View>
  );
}

/**
 * A segmented control: one of `options`, or none when `value` matches none of them. `fill` spreads
 * them across the width.
 */
export function Segments<T>({
  options,
  value,
  onChange,
  fill,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  fill?: boolean;
}): React.JSX.Element {
  return (
    <View style={styles.segments}>
      {options.map((option) => (
        <TouchableOpacity
          key={option.label}
          style={[
            styles.segment,
            fill && styles.segmentFill,
            option.value === value && styles.segmentActive,
          ]}
          onPress={() => onChange(option.value)}>
          <Text style={styles.segmentText}>{option.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

export const styles = StyleSheet.create({
  section: {
    gap: 12,
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 16,
  },
  sectionHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.dim,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: { fontSize: 14, color: colors.body },
  hint: { fontSize: 13, color: colors.dim },
  link: { fontSize: 13, color: colors.muted },
  links: { flexDirection: 'row', gap: 16 },
  flex: { flex: 1 },
  segments: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: 2,
  },
  segment: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6 },
  segmentFill: { flex: 1, alignItems: 'center' },
  segmentActive: { backgroundColor: colors.accent },
  segmentText: { fontSize: 13, color: colors.text },
});
