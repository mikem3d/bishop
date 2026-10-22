import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { radius, space, type, useTheme } from '../lib/theme';

/** A "+ Add …" line that turns into a text field. */
export function InlineAdd({ label, placeholder, onAdd }: { label: string; placeholder: string; onAdd: (name: string) => void }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');

  const submit = () => {
    const v = value.trim();
    if (v) onAdd(v);
    setValue('');
    setOpen(false);
  };

  if (!open) {
    return (
      <Pressable onPress={() => setOpen(true)} style={styles.trigger} accessibilityRole="button" hitSlop={6}>
        <Ionicons name="add" size={18} color={t.textMuted} />
        <Text style={[type.small, { color: t.textMuted, marginLeft: 4 }]}>{label}</Text>
      </Pressable>
    );
  }
  return (
    <View style={[styles.field, { borderColor: t.idle, backgroundColor: t.surface }]}>
      <TextInput
        autoFocus
        value={value}
        onChangeText={setValue}
        placeholder={placeholder}
        placeholderTextColor={t.textFaint}
        style={[type.body, { color: t.text, flex: 1, paddingVertical: space.md }]}
        returnKeyType="done"
        onSubmitEditing={submit}
        onBlur={() => !value.trim() && setOpen(false)}
        accessibilityLabel={placeholder}
      />
      <Pressable onPress={submit} hitSlop={8} accessibilityRole="button" accessibilityLabel="Save">
        <Ionicons name="checkmark-circle" size={26} color={t.idle} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  trigger: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.sm },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    marginVertical: space.xs,
  },
});
