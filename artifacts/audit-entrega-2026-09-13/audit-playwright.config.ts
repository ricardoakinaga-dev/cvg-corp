import original from './playwright.config.ts';
export default {...original, use:{...original.use,baseURL:'http://127.0.0.1:50429'},webServer:[
{command:'CVG_HOST=127.0.0.1 CVG_API_PORT=38995 CVG_WEB_ORIGIN=http://127.0.0.1:50429 CVG_STORAGE=memory CVG_DEMO_MODE=true CVG_RATE_LIMIT_REQUESTS_PER_WINDOW=10000 npm run dev:api',url:'http://127.0.0.1:38995/api/v1/health',reuseExistingServer:false,timeout:30000},
{command:'npx vite --config audit-vite.config.ts',url:'http://127.0.0.1:50429',reuseExistingServer:false,timeout:30000}]};
