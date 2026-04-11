import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        ink: "#111318",
        sand: "#f3ecdf",
        bronze: "#b28451",
        pine: "#0f3a32",
        mist: "#dce6e3"
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "sans-serif"],
        display: ["Georgia", "serif"]
      },
      boxShadow: {
        soft: "0 20px 60px rgba(17, 19, 24, 0.14)"
      },
      backgroundImage: {
        grain:
          "radial-gradient(circle at top, rgba(255,255,255,0.4), transparent 30%), linear-gradient(135deg, #f6f0e5 0%, #dce6e3 40%, #f8f5ee 100%)"
      }
    }
  },
  plugins: []
};

export default config;
