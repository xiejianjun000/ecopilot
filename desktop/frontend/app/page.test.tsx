import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import Page from './page'

// ---------------------------------------------------------------------------
// Mock the global store so AppShell renders with a controlled state.
// We mock the default export `AppProvider` and named export `useApp`.
// ---------------------------------------------------------------------------
vi.mock('@/lib/store', () => ({
  AppProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useApp: () => ({
    state: {
      activeNav: 'chat',
      rightPanelOpen: false,
      conversations: [],
      activeConversationId: null,
      messages: [],
      sending: false,
      progress: null,
      taskSummaries: [],
      outputFiles: [],
      memories: [],
      diaryEntries: [],
      prefillInput: null,
      reviewDocId: null,
      reviewIssues: [],
      browserDoc: null,
    },
    dispatch: vi.fn(),
  }),
}))

// ---------------------------------------------------------------------------
// Mock every child component so tests focus on layout structure.
// ---------------------------------------------------------------------------
vi.mock('@/components/left-sidebar', () => ({
  LeftSidebar: ({ open }: { open: boolean }) => (
    <div data-testid="left-sidebar" data-open={open}>LeftSidebar</div>
  ),
}))

vi.mock('@/components/chat-main', () => ({
  ChatMain: ({ leftOpen }: { leftOpen: boolean }) => (
    <div data-testid="chat-main" data-left-open={leftOpen}>ChatMain</div>
  ),
}))

vi.mock('@/components/right-panel', () => ({
  RightPanel: ({ open }: { open: boolean }) => (
    <div data-testid="right-panel" data-open={open}>RightPanel</div>
  ),
}))

vi.mock('@/components/user-panel', () => ({
  UserPanel: ({ open }: { open: boolean }) => (
    <div data-testid="user-panel" data-open={open}>UserPanel</div>
  ),
}))

vi.mock('@/components/global-search', () => ({
  GlobalSearch: ({ open }: { open: boolean }) => (
    <div data-testid="global-search" data-open={open}>GlobalSearch</div>
  ),
}))

vi.mock('@/components/notification-center', () => ({
  NotificationCenter: ({ open }: { open: boolean }) => (
    <div data-testid="notification-center" data-open={open}>NotificationCenter</div>
  ),
}))

vi.mock('@/components/qr-connect', () => ({
  QrConnect: ({ open }: { open: boolean }) => (
    <div data-testid="qr-connect" data-open={open}>QrConnect</div>
  ),
}))

vi.mock('@/components/discover-panel', () => ({
  DiscoverPanel: ({ open }: { open: boolean }) => (
    <div data-testid="discover-panel" data-open={open}>DiscoverPanel</div>
  ),
}))

vi.mock('@/components/feedback-modal', () => ({
  FeedbackModal: ({ open }: { open: boolean }) => (
    <div data-testid="feedback-modal" data-open={open}>FeedbackModal</div>
  ),
}))

vi.mock('@/components/setting-modal', () => ({
  SettingModal: ({ open }: { open: boolean }) => (
    <div data-testid="setting-modal" data-open={open}>SettingModal</div>
  ),
}))

vi.mock('@/components/md-viewer', () => ({
  MdViewer: ({ open }: { open: boolean }) => (
    <div data-testid="md-viewer" data-open={open}>MdViewer</div>
  ),
}))

// ---------------------------------------------------------------------------
// jsdom does not provide window.matchMedia — stub it so the responsive
// sidebar-effect in AppShell does not crash.
// ---------------------------------------------------------------------------
beforeEach(() => {
  localStorage.setItem('ecopilot-onboarding-done', 'true')
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
})

describe('Page - main app layout', () => {
  it('renders the main app shell with sidebar and chat area', () => {
    render(<Page />)

    // Core layout columns
    expect(screen.getByTestId('left-sidebar')).toBeInTheDocument()
    expect(screen.getByTestId('chat-main')).toBeInTheDocument()

    // Overlay panels should exist in DOM (all closed by default)
    expect(screen.getByTestId('user-panel')).toBeInTheDocument()
    expect(screen.getByTestId('global-search')).toBeInTheDocument()
    expect(screen.getByTestId('notification-center')).toBeInTheDocument()
    expect(screen.getByTestId('qr-connect')).toBeInTheDocument()
    expect(screen.getByTestId('discover-panel')).toBeInTheDocument()
    expect(screen.getByTestId('feedback-modal')).toBeInTheDocument()
    expect(screen.getByTestId('setting-modal')).toBeInTheDocument()
    expect(screen.getByTestId('md-viewer')).toBeInTheDocument()
  })

  it('renders left sidebar open by default', () => {
    render(<Page />)
    const sidebar = screen.getByTestId('left-sidebar')
    expect(sidebar).toHaveAttribute('data-open', 'true')
  })

  it('passes leftOpen prop to ChatMain', () => {
    render(<Page />)
    const chat = screen.getByTestId('chat-main')
    expect(chat).toHaveAttribute('data-left-open', 'true')
  })

  it('renders left resize handle when sidebar is open', () => {
    render(<Page />)
    // The resize handle is the element with cursor-col-resize class
    const handles = document.querySelectorAll('.cursor-col-resize')
    expect(handles.length).toBeGreaterThanOrEqual(1)
  })

  it('does not show right panel when rightPanelOpen is false in chat mode', () => {
    render(<Page />)
    const rightPanel = screen.getByTestId('right-panel')
    // Right panel exists because isChat=true renders the wrapper div,
    // but its open prop should be false
    expect(rightPanel).toHaveAttribute('data-open', 'false')
  })

  it('does not show mobile overlay button when sidebar is open and in chat mode', () => {
    // leftOpen && !isChat controls the overlay button — isChat=true so button is hidden
    render(<Page />)
    const overlayBtn = document.querySelector('button[aria-label="关闭面板"]')
    expect(overlayBtn).not.toBeInTheDocument()
  })
})
