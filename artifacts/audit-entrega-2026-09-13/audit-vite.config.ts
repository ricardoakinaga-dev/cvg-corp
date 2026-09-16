import original from "./apps/web/vite.config.ts"; export default {...original, server: {host:"127.0.0.1",port:50429,strictPort:true,proxy:{"/api":"http://127.0.0.1:38995"}}};
