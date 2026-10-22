import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { Avatar } from '../components/Avatar';
import { Button, ErrorLine } from '../components/ui';
import { sendCode, verifyCode } from '../lib/auth';
import { isConfigured } from '../lib/supabase';
import { radius, space, type, useTheme } from '../lib/theme';

/** Email a code, then type it in. No passwords, no links to tap. */
export default function SignIn() {
  const t = useTheme();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const input = [styles.input, { color: t.text, backgroundColor: t.surface, borderColor: t.border }];

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.wrap, { backgroundColor: t.bg }]}
    >
      <View style={styles.center}>
        <Avatar state={step === 'code' ? 'thinking' : 'idle'} size={128} />
        <Text style={[type.title, { color: t.text, marginTop: space.lg }]}>Bishop</Text>
        <Text style={[type.body, { color: t.textMuted, marginTop: space.xs, textAlign: 'center' }]}>
          {step === 'email' ? 'Sign in with your email.' : `Enter the 6-digit code sent to ${email}.`}
        </Text>
      </View>

      {!isConfigured ? (
        <Text style={[type.small, { color: t.needsYou, marginBottom: space.md }]}>
          Supabase isn't configured. Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY to apps/mobile/.env.
        </Text>
      ) : null}

      {step === 'email' ? (
        <>
          <TextInput
            style={input}
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={t.textFaint}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            returnKeyType="send"
            accessibilityLabel="Email"
            onSubmitEditing={() => email.includes('@') && run(async () => { await sendCode(email); setStep('code'); })}
          />
          <Button
            label="Send code"
            loading={busy}
            disabled={!email.includes('@')}
            onPress={() => run(async () => { await sendCode(email); setStep('code'); })}
          />
        </>
      ) : (
        <>
          <TextInput
            style={[input, { letterSpacing: 8, fontSize: 24, textAlign: 'center' }]}
            value={code}
            onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            placeholderTextColor={t.textFaint}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            autoFocus
            accessibilityLabel="Sign-in code"
          />
          <Button label="Sign in" loading={busy} disabled={code.length < 6} onPress={() => run(() => verifyCode(email, code))} />
          <View style={{ height: space.sm }} />
          <Button label="Use a different email" kind="secondary" onPress={() => { setStep('email'); setCode(''); }} />
        </>
      )}
      <ErrorLine error={error} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: space.xl, justifyContent: 'center' },
  center: { alignItems: 'center', marginBottom: space.xxl },
  input: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    minHeight: 52,
    fontSize: 17,
    marginBottom: space.md,
  },
});
