import { Link } from 'react-router-dom'
import { Container, Group, Button, Text, Paper } from '@mantine/core'

export default function Header({ user, onLogout }) {
  return (
    <Paper component="header" shadow="xs" p="sm">
      <Container size="lg">
        <Group justify="space-between">
          <Group gap="sm">
            <Text fw={700}>AI Video Studio</Text>
            <Text size="sm" c="dimmed">Generate short cinematic clips</Text>
          </Group>
          <Group gap="sm">
            {user ? (
              <>
                <Button component={Link} to="/" variant="default">Generate</Button>
                <Button component={Link} to="/history" variant="default">History</Button>
                <Text size="sm" c="dimmed">{user.username}</Text>
                <Button color="red" onClick={onLogout}>Logout</Button>
              </>
            ) : (
              <Text size="sm" c="dimmed">Not signed in</Text>
            )}
          </Group>
        </Group>
      </Container>
    </Paper>
  )
}
