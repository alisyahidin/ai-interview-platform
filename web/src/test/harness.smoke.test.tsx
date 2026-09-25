import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";

// Proves the test harness itself works end to end (Vitest + Testing Library +
// jsdom + vitest-axe + MSW, wired via vite.config.ts / src/test/setup.ts).
// Feature coverage belongs in PR2-4, not here.
function Greeting() {
    return <button type="button">Hello, harness</button>;
}

describe("test harness", () => {
    it("renders with Testing Library under jsdom", () => {
        render(<Greeting />);
        expect(screen.getByRole("button", { name: /hello, harness/i })).toBeInTheDocument();
    });

    it("runs an axe scan with zero violations", async () => {
        const { container } = render(<Greeting />);
        const results = await axe(container);
        expect(results.violations).toEqual([]);
    });

    it("resolves a mocked network request via MSW", async () => {
        const response = await fetch("http://localhost:3001/api/v1/health");
        const body = await response.json();
        expect(body.data.status).toBe("ok");
    });
});
