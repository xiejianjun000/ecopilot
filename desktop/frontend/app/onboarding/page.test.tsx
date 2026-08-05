import "@testing-library/jest-dom/vitest"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import OnboardingPage from "./page"

const mockUseOnboarding = vi.fn(() => ({ state: { step: 0 } }))

vi.mock("@/lib/onboarding-store", () => ({
  OnboardingProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="onboarding-provider">{children}</div>
  ),
  useOnboarding: (...args: unknown[]) => mockUseOnboarding(...args),
}))

vi.mock("@/components/onboarding/brand-step", () => ({
  BrandStep: () => <div data-testid="brand-step" />,
}))
vi.mock("@/components/onboarding/model-config-step", () => ({
  ModelConfigStep: () => <div data-testid="model-config-step" />,
}))
vi.mock("@/components/onboarding/platform-login-step", () => ({
  PlatformLoginStep: () => <div data-testid="platform-login-step" />,
}))
vi.mock("@/components/onboarding/permit-reading-step", () => ({
  PermitReadingStep: () => <div data-testid="permit-reading-step" />,
}))
vi.mock("@/components/onboarding/register-step", () => ({
  RegisterStep: () => <div data-testid="register-step" />,
}))

describe("OnboardingPage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("renders the onboarding provider", () => {
    render(<OnboardingPage />)
    expect(screen.getByTestId("onboarding-provider")).toBeTruthy()
  })
})
