/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        magenta: { DEFAULT: '#B31C86', d: '#8E1268', soft: '#FBEEF6' },
        navy: { DEFAULT: '#1C2540', 2: '#28324F', soft: '#EEF1F8' },
        ink: '#1C2540',
        muted: '#6A7089',
        faint: '#9AA0B4',
        bg: '#F5F6FB',
        card: '#FFFFFF',
        line: { DEFAULT: '#E7E9F2', 2: '#EFF1F7' },
        ok: { DEFAULT: '#1F9D6B', soft: '#E7F5EE' },
        warn: { DEFAULT: '#C9880E', soft: '#FBF1DE' },
        danger: { DEFAULT: '#C0392B', soft: '#FBEAE7' },
        teal: { DEFAULT: '#2C7FB8', soft: '#E6F0F7' },
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        display: ['"Playfair Display"', 'serif'],
      },
      borderRadius: { base: '14px' },
      boxShadow: {
        card: '0 1px 2px rgba(28,37,64,.06), 0 8px 24px rgba(28,37,64,.05)',
      },
      keyframes: {
        fade: { from: { opacity: 0, transform: 'translateY(6px)' }, to: { opacity: 1, transform: 'none' } },
        pop: { from: { opacity: 0, transform: 'scale(.96)' }, to: { opacity: 1, transform: 'none' } },
        slideup: { from: { opacity: 0, transform: 'translateY(24px)' }, to: { opacity: 1, transform: 'none' } },
      },
      animation: {
        fade: 'fade .35s ease both',
        pop: 'pop .3s ease both',
        slideup: 'slideup .3s ease both',
      },
    },
  },
  plugins: [],
};
