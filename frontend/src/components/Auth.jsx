import { useState } from 'react'
import { Paper, Title, TextInput, PasswordInput, Button, Group, Anchor, Stack, Text } from '@mantine/core'

export default function Auth({ onAuth }) {
  const [mode, setMode] = useState('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setLoading(true)
    try {
      // Delegate to parent; parent handles login/register as needed
      await onAuth?.(username, password)
    } catch (e) {
      // Parent shows toast on failure; keep a lightweight fallback
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Paper p="lg" radius="md" withBorder maw={480} mx="auto" shadow="sm">
      <Group justify="space-between" mb="sm">
        <Title order={3}>{mode === 'login' ? 'Login' : 'Create account'}</Title>
        <Text size="sm" c="dimmed">
          {mode === 'login' ? (
            <Anchor onClick={() => setMode('signup')} underline="always">Create account</Anchor>
          ) : (
            <Anchor onClick={() => setMode('login')} underline="always">Have an account?</Anchor>
          )}
        </Text>
      </Group>
      <form onSubmit={submit}>
        <Stack gap="sm">
          <TextInput
            label="Username"
            value={username}
            onChange={(e) => setUsername(e.currentTarget.value)}
            required
          />
          <PasswordInput
            label="Password"
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
            required
          />
          <Group justify="flex-end" mt="xs">
            <Button type="submit" loading={loading}>
              {mode === 'login' ? 'Login' : 'Sign up'}
            </Button>
          </Group>
        </Stack>
      </form>
    </Paper>
  )
}