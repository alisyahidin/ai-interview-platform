/** @type {import('tailwindcss').Config} */
export default {
    darkMode: ["class"],
    content: ["./index.html", "./src/**/*.{ts,tsx}"],
    theme: {
        extend: {
            colors: {
                border: "hsl(var(--border))",
                input: "hsl(var(--input))",
                ring: "hsl(var(--ring))",
                background: "hsl(var(--background))",
                foreground: "hsl(var(--foreground))",
                primary: {
                    DEFAULT: "hsl(var(--primary))",
                    foreground: "hsl(var(--primary-foreground))",
                },
                secondary: {
                    DEFAULT: "hsl(var(--secondary))",
                    foreground: "hsl(var(--secondary-foreground))",
                },
                destructive: {
                    DEFAULT: "hsl(var(--destructive))",
                    foreground: "hsl(var(--destructive-foreground))",
                },
                muted: {
                    DEFAULT: "hsl(var(--muted))",
                    foreground: "hsl(var(--muted-foreground))",
                },
                accent: {
                    DEFAULT: "hsl(var(--accent))",
                    foreground: "hsl(var(--accent-foreground))",
                },
                card: {
                    DEFAULT: "hsl(var(--card))",
                    foreground: "hsl(var(--card-foreground))",
                },
                popover: {
                    DEFAULT: "hsl(var(--popover))",
                    foreground: "hsl(var(--popover-foreground))",
                },
                // Phase 3b (#23): judgment-badge tokens (assessed / tentative /
                // not-assessed / needs-review), consumed by `badgeVariants` in
                // src/components/ui/badge.tsx. See src/index.css for values.
                judgment: {
                    assessedBg: "hsl(var(--judgment-assessed-bg))",
                    assessedFg: "hsl(var(--judgment-assessed-fg))",
                    tentativeBorder: "hsl(var(--judgment-tentative-border))",
                    tentativeFg: "hsl(var(--judgment-tentative-fg))",
                    neutralBg: "hsl(var(--judgment-neutral-bg))",
                    neutralBorder: "hsl(var(--judgment-neutral-border))",
                    neutralFg: "hsl(var(--judgment-neutral-fg))",
                    reviewBg: "hsl(var(--judgment-review-bg))",
                    reviewFg: "hsl(var(--judgment-review-fg))",
                    reviewBorder: "hsl(var(--judgment-review-border))",
                },
            },
            borderRadius: {
                lg: "var(--radius)",
                md: "calc(var(--radius) - 2px)",
                sm: "calc(var(--radius) - 4px)",
            },
            keyframes: {
                "accordion-down": {
                    from: { height: "0" },
                    to: { height: "var(--radix-accordion-content-height)" },
                },
                "accordion-up": {
                    from: { height: "var(--radix-accordion-content-height)" },
                    to: { height: "0" },
                },
                "voice-bar": {
                    "0%, 100%": { height: "4px" },
                    "50%": { height: "32px" },
                },
            },
            animation: {
                "accordion-down": "accordion-down 0.2s ease-out",
                "accordion-up": "accordion-up 0.2s ease-out",
                "voice-bar": "voice-bar 0.8s ease-in-out infinite",
            },
        },
    },
    plugins: [require("tailwindcss-animate")],
};
