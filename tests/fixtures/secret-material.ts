// Synthetic values only; these fixtures never authenticate against a service.
const marker = "synthetic-secret-pattern-sentinel-123456";
const basic = Buffer.from(`synthetic-user:${marker}`).toString("base64");
const awsId = "AKIA" + "SYNTHETIC".padEnd(16, "0");
const temporaryAwsId = "ASIA" + "SYNTHETIC".padEnd(16, "0");
const googleKey = "AIza" + "Synthetic".padEnd(35, "0");
const jwt = [
  Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
  Buffer.from(JSON.stringify({ sub: marker })).toString("base64url"),
  Buffer.from("synthetic-signature-not-valid").toString("base64url")
].join(".");

export const passwordPolicyPrompts: readonly string[] = [
  "a senha é importante para a segurança",
  "the password is stored hashed",
  "our password is rotated monthly",
  "password is expired please reset",
  "a senha é gerenciada pelo cofre"
];

export const secretMaterialCases: readonly { name: string; prompt: string; secret: string }[] = [
  { name: "plain password", prompt: `password=${marker}`, secret: marker },
  { name: "JSON password", prompt: JSON.stringify({ password: marker }), secret: marker },
  { name: "partially pasted JSON password", prompt: `{"password": "${marker}`, secret: marker },
  { name: "partially pasted quoted password", prompt: `password='${marker}`, secret: marker },
  { name: "prefixed password assignment", prompt: `servicePassword=${marker}`, secret: marker },
  { name: "JSON API key", prompt: JSON.stringify({ api_key: marker }), secret: marker },
  { name: "camel-case API key", prompt: JSON.stringify({ apiKey: marker }), secret: marker },
  { name: "single-quoted secret", prompt: `{'secret': '${marker}'}`, secret: marker },
  { name: "generic token", prompt: `token=${marker}`, secret: marker },
  { name: "access token", prompt: JSON.stringify({ access_token: marker }), secret: marker },
  { name: "refresh token", prompt: JSON.stringify({ refreshToken: marker }), secret: marker },
  { name: "client secret", prompt: JSON.stringify({ client_secret: marker }), secret: marker },
  { name: "environment API key", prompt: `export SERVICE_API_KEY="${marker}"`, secret: marker },
  { name: "Portuguese password", prompt: `senha: ${marker}`, secret: marker },
  { name: "Portuguese prose password", prompt: "minha senha é Abc12345!", secret: "Abc12345!" },
  { name: "Portuguese imperative password", prompt: "use a senha Zx9!kLm2 para entrar", secret: "Zx9!kLm2" },
  { name: "English prose password", prompt: "my password is Hunter2!x", secret: "Hunter2!x" },
  { name: "English imperative password", prompt: `use the password ${marker} to sign in`, secret: marker },
  { name: "quoted prose password", prompt: `minha senha é "${marker}"`, secret: marker },
  { name: "possessive prose password", prompt: "a senha dele é Zx9kLm2p", secret: "Zx9kLm2p" },
  { name: "prose colon password", prompt: "my password is: Hunter2!x", secret: "Hunter2!x" },
  { name: "space-separated prose password", prompt: "senha é abc 12345", secret: "abc 12345" },
  { name: "prose internal mixed case", prompt: "password is huNterOnly", secret: "huNterOnly" },
  { name: "prose internal symbol", prompt: "senha é alpha_beta", secret: "alpha_beta" },
  { name: "overlapping English introducer", prompt: `password is password is ${marker}`, secret: marker },
  { name: "overlapping Portuguese introducer", prompt: `password is senha é ${marker}`, secret: marker },
  { name: "overlapping possessive introducer", prompt: `password is: senha dele é ${marker}`, secret: marker },
  { name: "overlapping English instructions", prompt: `use password use password ${marker}`, secret: marker },
  { name: "overlapping Portuguese instructions", prompt: `utilize a senha utilize a senha ${marker}`, secret: marker },
  { name: "Portuguese secret", prompt: `segredo: ${marker}`, secret: marker },
  { name: "JSON Portuguese secret", prompt: JSON.stringify({ segredo: marker }), secret: marker },
  { name: "cloud suffixed secret", prompt: `AWS_SECRET_ACCESS_KEY=${marker}`, secret: marker },
  { name: "quoted cloud suffixed secret", prompt: `export AWS_SECRET_ACCESS_KEY="${marker}"`, secret: marker },
  { name: "camel-case cloud secret", prompt: JSON.stringify({ secretAccessKey: marker }), secret: marker },
  { name: "AWS key identifier", prompt: `Identificador sintético ${awsId}`, secret: awsId },
  { name: "AWS temporary key identifier", prompt: `Identificador sintético ${temporaryAwsId}`, secret: temporaryAwsId },
  { name: "Google API key", prompt: `Credencial sintética ${googleKey}`, secret: googleKey },
  ...["xoxb", "xoxp", "xoxa", "xoxr", "xoxs", "xoxc", "xoxd"].map((prefix) => ({
    name: `${prefix} credential`, prompt: `Credencial sintética ${prefix}-${marker}`, secret: marker
  })),
  { name: "bare Basic credential", prompt: `Basic ${basic}`, secret: basic },
  { name: "mixed-case bare Basic credential", prompt: `bAsIc ${basic}`, secret: basic },
  { name: "pwd assignment", prompt: `pwd=${marker}`, secret: marker },
  { name: "pwd after directory output", prompt: `pwd: /home/user/projeto/src\npwd: ${marker}`, secret: marker },
  { name: "directory-shaped actual password", prompt: "password=/home/user/projeto/src", secret: "/home/user/projeto/src" },
  { name: "Bearer header", prompt: `Authorization: Bearer ${marker}`, secret: marker },
  { name: "bare Bearer token", prompt: `Bearer ${marker}`, secret: marker },
  { name: "JSON authorization", prompt: JSON.stringify({ Authorization: `Bearer ${marker}` }), secret: marker },
  { name: "Basic header", prompt: `Authorization: Basic ${basic}`, secret: basic },
  { name: "raw API token", prompt: `Chave de teste sk-${marker}`, secret: marker },
  { name: "project API token", prompt: `Chave de teste sk-proj-${marker}`, secret: marker },
  { name: "GitHub-style token", prompt: `Token de teste ghp_${marker.replaceAll("-", "")}`, secret: marker.replaceAll("-", "") },
  { name: "JWT", prompt: `Token de teste: ${jwt}`, secret: jwt },
  { name: "connection URL", prompt: `postgresql://synthetic-user:${marker}@localhost/test`, secret: marker },
  ...["", "RSA ", "EC ", "OPENSSH ", "ENCRYPTED "].map((kind) => ({
    name: `${kind}private key`,
    prompt: `-----BEGIN ${kind}PRIVATE KEY-----\n${marker}\n-----END ${kind}PRIVATE KEY-----`,
    secret: marker
  }))
];

export const nonSecretPrompts: readonly string[] = [
  "Resuma a agenda e os retornos dos pacientes.",
  "Explique como trocar a senha sem compartilhar credenciais.",
  "Explique os campos api_key, password, secret e access_token.",
  "Explique autenticação Bearer e MFA.",
  "tokenBudget=4096; passwordLength=12; secretRef=cofre.local",
  '{"password":"","api_key":null,"tokenCount":4096}',
  "https://example.test/help?topic=password",
  "-----BEGIN PUBLIC KEY-----\nsynthetic-public-data\n-----END PUBLIC KEY-----",
  "sk-short",
  "pwd: /home/user/projeto/src",
  "PWD: /home/user/projeto/src\nProcesso concluído.",
  "pwd: C:\\Users\\user\\projeto\\src",
  "pwd: ~/projeto/src",
  "Basic authentication is configured.",
  "Basic configuration is available.",
  'WWW-Authenticate: Basic realm="example"',
  "Minha senha é obrigatória para entrar.",
  "My password is required to sign in.",
  "Use a senha cadastrada para entrar.",
  "Use a senha temporária para entrar.",
  "Minha senha é alfanumérica.",
  "My password is missing.",
  "Please use password protection for this file.",
  "Use a senha informada no formulário.",
  "Minha senha é temporária: como alterar?",
  "My password is missing: how can I reset it?",
  "Use a senha definida no cadastro.",
  ...passwordPolicyPrompts,
  "Os prefixos AKIA, ASIA, xoxb- e AIza identificam formatos.",
  "AWS_SECRET_ACCESS_KEY é o nome de uma variável, sem valor aqui."
];
