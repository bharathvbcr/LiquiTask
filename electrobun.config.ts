import type { ElectrobunConfig } from 'electrobun';

const config: ElectrobunConfig = {
    app: {
        name: 'LiquiTask',
        identifier: 'com.liquitask.app',
        version: '1.0.2',
        description: 'A premium Kanban task management desktop app with a stunning liquid glass aesthetic',
    },
    build: {
        bun: {
            entrypoint: 'src/bun/index.ts',
            sourcemap: 'external',
        },
        buildFolder: 'build-electrobun',
        artifactFolder: 'artifacts-electrobun',
        copy: {
            'dist': 'dist',
            'build/icon.png': 'assets/icon.png',
        },
        watch: ['dist'],
        watchIgnore: ['release/**'],
        win: {
            icon: 'build/icon.png',
        },
        linux: {
            icon: 'build/icon.png',
        },
    },
    runtime: {
        exitOnLastWindowClosed: true,
    },
    scripts: {
        preBuild: './scripts/pre-build.ts',
        postBuild: './scripts/post-build.ts',
    },
};

export default config;
