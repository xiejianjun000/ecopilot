import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { OnboardingProvider, useOnboarding } from './onboarding-store'

// ---------------------------------------------------------------------------
// useOnboarding — error case
// ---------------------------------------------------------------------------
describe('useOnboarding', () => {
  it('throws when called outside OnboardingProvider', () => {
    // Suppress React's console.error for the uncaught render error
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => renderHook(() => useOnboarding())).toThrow(
      'useOnboarding must be used within OnboardingProvider',
    )
    spy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// OnboardingProvider — default state
// ---------------------------------------------------------------------------
describe('OnboardingProvider', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  function setup() {
    return renderHook(() => useOnboarding(), { wrapper: OnboardingProvider })
  }

  // -----------------------------------------------------------------------
  // Default state
  // -----------------------------------------------------------------------
  describe('default state', () => {
    it('returns default values', () => {
      const { result } = setup()
      expect(result.current.state).toStrictEqual({
        step: 'brand',
        modelReady: false,
        textModel: '',
        visionModel: '',
        sessionId: '',
        loginMethod: '',
        permitData: null,
        permitOutlets: [],
        phone: '',
        name: '',
        role: '环保专员',
      })
    })
  })

  // -----------------------------------------------------------------------
  // State updaters
  // -----------------------------------------------------------------------
  describe('setStep', () => {
    it('updates the step value', () => {
      const { result } = setup()

      act(() => result.current.setStep('model-config'))
      expect(result.current.state.step).toBe('model-config')

      act(() => result.current.setStep('complete'))
      expect(result.current.state.step).toBe('complete')
    })
  })

  describe('setModelReady', () => {
    it('sets modelReady to true and stores model names', () => {
      const { result } = setup()
      act(() => result.current.setModelReady('claude-3', 'claude-3-vision'))

      expect(result.current.state.modelReady).toBe(true)
      expect(result.current.state.textModel).toBe('claude-3')
      expect(result.current.state.visionModel).toBe('claude-3-vision')
    })
  })

  describe('setLoginMethod', () => {
    it('updates login method', () => {
      const { result } = setup()

      act(() => result.current.setLoginMethod('safari'))
      expect(result.current.state.loginMethod).toBe('safari')

      act(() => result.current.setLoginMethod('quick'))
      expect(result.current.state.loginMethod).toBe('quick')
    })
  })

  describe('setSessionId', () => {
    it('updates session id', () => {
      const { result } = setup()
      act(() => result.current.setSessionId('sid__abc'))
      expect(result.current.state.sessionId).toBe('sid__abc')
    })
  })

  describe('setPermitData', () => {
    it('stores permit data and outlets', () => {
      const { result } = setup()
      const data = { orgId: 'org_1', approved: true }
      const outlets = [{ id: 'outlet_1', name: 'Outlet A' }]

      act(() => result.current.setPermitData(data, outlets))

      expect(result.current.state.permitData).toStrictEqual(data)
      expect(result.current.state.permitOutlets).toStrictEqual(outlets)
    })
  })

  describe('setUser', () => {
    it('updates phone, name, and role', () => {
      const { result } = setup()
      act(() => result.current.setUser('13900001111', '李四', '执法员'))

      expect(result.current.state.phone).toBe('13900001111')
      expect(result.current.state.name).toBe('李四')
      expect(result.current.state.role).toBe('执法员')
    })
  })

  describe('reset', () => {
    it('resets state to defaults and clears localStorage', () => {
      const { result } = setup()

      // Mutate state
      act(() => {
        result.current.setStep('complete')
        result.current.setModelReady('gpt-4', 'gpt-4-vision')
        result.current.setUser('13800138000', '王五', '环保专员')
      })
      expect(result.current.state.step).toBe('complete')

      // Reset
      act(() => result.current.reset())

      expect(result.current.state.step).toBe('brand')
      expect(result.current.state.modelReady).toBe(false)
      expect(result.current.state.textModel).toBe('')
      expect(result.current.state.phone).toBe('')

      // localStorage is re-populated with defaults (the persistence
      // effect fires after reset restores defaultState)
      const saved = JSON.parse(localStorage.getItem('ecopilot-onboarding')!)
      expect(saved.step).toBe('brand')
      expect(saved.textModel).toBe('')
    })
  })

  // -----------------------------------------------------------------------
  // localStorage persistence
  // -----------------------------------------------------------------------
  describe('localStorage', () => {
    it('persists step changes to localStorage', () => {
      setup()
      // The provider runs a useEffect on mount that saves default state
      expect(localStorage.getItem('ecopilot-onboarding')).not.toBeNull()
    })

    it('excludes permitData from persisted value', () => {
      const { result } = setup()
      act(() => result.current.setPermitData({ token: 'x' }, []))
      const saved = JSON.parse(localStorage.getItem('ecopilot-onboarding')!)
      expect(saved.permitData).toBeNull()
    })

    it('restores saved state from localStorage on mount', () => {
      localStorage.setItem(
        'ecopilot-onboarding',
        JSON.stringify({
          step: 'register',
          modelReady: true,
          textModel: 'gpt-4',
          visionModel: 'gpt-4-vision',
          sessionId: 'restored-sid',
          loginMethod: 'quick',
          phone: '13900009999',
          name: '赵六',
          role: '审核员',
        }),
      )

      const { result } = setup()
      expect(result.current.state.step).toBe('register')
      expect(result.current.state.textModel).toBe('gpt-4')
      expect(result.current.state.phone).toBe('13900009999')
    })
  })
})
