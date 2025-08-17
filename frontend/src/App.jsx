import React, { useState, useEffect } from 'react'
import Header from './components/Header'
import Auth from './components/Auth'
import useToast from './hooks/useToast'
import { login } from './services/api'
import { improvePrompt, startGeneration, jobStatus } from './services/api';
import { Routes, Route, Navigate } from 'react-router-dom'
import History from './components/History'
import { Container, Center, Stack, TextInput, Button, Group, Paper, Text, Loader, Title, Progress, UnstyledButton, Divider, Box, Transition } from '@mantine/core'

export default function App(){
  const [user, setUser] = useState(null)
  const [prompt, setPrompt] = useState('')
  const [enhancedPrompt, setEnhancedPrompt] = useState('')
  const [concisePrompts, setConcisePrompts] = useState([])
  const [negativePrompt, setNegativePrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [mp4Url, setMp4Url] = useState(null)
  const [inlineDownloading, setInlineDownloading] = useState(false)
  const [toast, showToast] = useToast()

  async function handleEnhancePrompt() {
    try {
      setLoading(true)
      setProgress(0)
      setEnhancedPrompt('')
      setConcisePrompts([])
      const response = await improvePrompt(prompt)
      setEnhancedPrompt(response.auto_improved)
      setConcisePrompts(response.variants || [])
    } catch (err) {
      showToast('Failed to enhance prompt!')
    } finally {
      setLoading(false)
    }
  }

  const pollIntervalRef = React.useRef(null);

  async function handleGenerateVideo(inputPrompt) {
    setLoading(true);
    setProgress(0);
    setMp4Url(null);
    try {
      const response = await startGeneration({
        prompt: inputPrompt,
        negative_prompt: negativePrompt,
        hls: false,
      });
      const jobId = response.job_id;
      if (!jobId) throw new Error('No job_id returned from backend');
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      const pollStatus = async () => {
        try {
          const data = await jobStatus(jobId);
          console.log('[pollStatus]', data);
          if (data && typeof data.progress === 'number') {
            setProgress(Math.round(data.progress));
          }
          if (data && data.status === 'done' && data.mp4_url) {
            setMp4Url(data.mp4_url || null);
            setLoading(false);
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
          if (data && data.status === 'error') {
            showToast(data.error || 'Video generation failed.');
            setLoading(false);
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
        } catch (e) {
          console.error('Polling fetch failed:', e);
          showToast('Network error while polling video status.');
          setLoading(false);
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        };
      };
      pollIntervalRef.current = setInterval(pollStatus, 1500);
      pollStatus();
    } catch (err) {
      showToast('Failed to generate video!');
      setLoading(false);
    }
  }

  React.useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  async function handleInlineDownload() {
    if (!mp4Url) return;
    try {
      setInlineDownloading(true);
      const res = await fetch(mp4Url);
      if (!res.ok) throw new Error(`Download failed: ${res.status}`);
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      const base = (prompt || 'video').toString().slice(0, 50).replace(/[^a-z0-9-_ ]/gi, '').replace(/\s+/g, '_') || 'video';
      a.href = url;
      a.download = `${base}.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      showToast(e.message || 'Download failed');
    } finally {
      setInlineDownloading(false);
    }
  }

  async function handleLogin(username, password) {
    try {
      const response = await login(username, password) // Dummy login
      setUser(response.user)
      showToast('Login successful!')
    } catch (err) {
      showToast('Login failed!')
    }
  }

  function onLogout() {
    setUser(null)
    showToast('Logged out')
  }

  if (!user) {
    return (
      <div className="min-h-screen" style={{ backgroundColor: '#121110' }}>
        <Header user={null} onLogout={onLogout} />
        <Container size="xl" p="lg" style={{ position: 'relative' }}>
          <Center style={{ minHeight: 'calc(100vh - 96px)' }}>
            <div style={{ width: '100%', maxWidth: 880 }}>
              <Auth onAuth={handleLogin} />
            </div>
          </Center>
          {/* Quick tip pinned to the right side */}
          <div style={{ position: 'fixed', right: 24, top: '50%', transform: 'translateY(-50%)', zIndex: 10, maxWidth: 280 }}>
            <Paper p="sm" shadow="sm" radius="md">
              <Title order={6} mb="xs">Quick tip</Title>
              <Text size="xs" c="dimmed">Try: "A golden retriever leaps to catch a frisbee on a windy beach at sunset"</Text>
            </Paper>
            <Paper p="sm" shadow="sm" radius="md" style={{ marginTop: 12 }}>
              <Text size="xs" c="dimmed">Register, or simply login using</Text>
              <Text size="xs">username: "<strong>a</strong>" password: "<strong>a</strong>"</Text>
            </Paper>
          </div>
        </Container>
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#121110' }}>
      <Header user={user} onLogout={onLogout} />
      <Container size="lg" p="lg">
        <Routes>
          <Route
            path="/"
            element={
              <Center style={{ minHeight: 'calc(100vh - 96px)' }}>
                <Stack w="100%" maw={720}>
                  {/* Loading spinner and progress */}
                  {loading && (
                    <Group align="center">
                      <Loader size="sm" />
                      <Text c="dimmed">{progress}%</Text>
                    </Group>
                  )}
                  {/* Video player after generation (MP4 only) */}
                  {!loading && mp4Url && (
                    <Paper p="sm" radius="md" withBorder>
                      <video controls style={{ width: '100%', borderRadius: 8 }}>
                        <source src={mp4Url} type="video/mp4" />
                      </video>
                      <Button onClick={handleInlineDownload} mt="sm" variant="light" loading={inlineDownloading} disabled={inlineDownloading}>
                        Download Video
                      </Button>
                    </Paper>
                  )}
                  {/* Prompt input row */}
                  <Group wrap="nowrap">
                    <TextInput
                      placeholder="Enter your prompt..."
                      value={prompt}
                      onChange={(e) => setPrompt(e.currentTarget.value)}
                      style={{ flexGrow: 1 }}
                      disabled={loading}
                    />
                    <Button
                      onClick={() => handleGenerateVideo(enhancedPrompt || prompt)}
                      disabled={loading || !(prompt || enhancedPrompt)}
                    >
                      Send
                    </Button>
                    <Button
                      variant="default"
                      onClick={handleEnhancePrompt}
                      disabled={loading || !prompt}
                    >
                      Enhance
                    </Button>
                  </Group>
                  {/* Enhanced prompt button (no animation, auto-wrap text) */}
                  {enhancedPrompt && (
                    <Button
                      variant="light"
                      fullWidth
                      className="wrap-button"
                      style={{
                        height: 'auto',
                        minHeight: 56,
                        paddingTop: 14,
                        paddingBottom: 14,
                        textAlign: 'left',
                      }}
                      onClick={() => handleGenerateVideo(enhancedPrompt)}
                      disabled={loading}
                    >
                      <span className="button-multiline">{enhancedPrompt}</span>
                    </Button>
                  )}
                  {/* Concise prompt ideas */}
                  {concisePrompts.length > 0 && (
                    <Stack gap={0}>
                      {concisePrompts.map((idea, idx) => (
                        <Transition key={idx} mounted={true} transition="slide-right" duration={280} timingFunction="ease-out">
                          {(styles) => (
                            <Box style={{ ...styles, transitionDelay: `${idx * 50}ms` }}>
                              <UnstyledButton
                                className="idea-row"
                                onClick={() => setEnhancedPrompt(idea.expanded)}
                                disabled={loading}
                                style={{
                                  width: '100%',
                                  padding: '10px 8px',
                                  color: 'inherit',
                                  textAlign: 'left',
                                  cursor: 'pointer',
                                }}
                              >
                                {idea.concise}
                              </UnstyledButton>
                              {idx < concisePrompts.length - 1 && <Divider />}
                            </Box>
                          )}
                        </Transition>
                      ))}
                    </Stack>
                  )}
                  {/* Negative prompt input */}
                  <Group justify="flex-end">
                    <Box style={{ width: '50%' }}>
                      <TextInput
                        placeholder="Enter negative prompt (optional)..."
                        value={negativePrompt}
                        onChange={(e) => setNegativePrompt(e.currentTarget.value)}
                        disabled={loading}
                      />
                    </Box>
                  </Group>
                </Stack>
              </Center>
            }
          />
          <Route path="/history" element={<History />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Container>
      {/* Toasts */}
      <div style={{position:'fixed', right:20, bottom:20, zIndex:9999}}>
        {toast.visible && (
          <Paper p="sm" radius="md" shadow="sm">
            {toast.message}
          </Paper>
        )}
      </div>
    </div>
  )
}
