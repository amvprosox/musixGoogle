import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          include: [
            'tests/parse.test.ts',
            'tests/validate.test.ts',
            'tests/innertube.test.ts',
            'tests/state.test.ts',
            'tests/contract.test.ts',
          ],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'dom',
          include: ['tests/bridge.test.ts'],
          environment: 'jsdom',
          environmentOptions: {
            jsdom: { url: 'https://music.youtube.com/watch?v=lYBUbBu4W08&list=RDAMVMlYBUbBu4W08' },
          },
        },
      },
    ],
  },
});
