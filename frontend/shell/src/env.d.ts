// Webpack reemplaza process.env.NODE_ENV en tiempo de compilación.
declare const process: { env: { NODE_ENV: 'development' | 'production' } };
