/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: "/customer",
  trailingSlash: true,
  ...(process.env.DFC_LOCAL_BUILD === "1" ? { experimental: { cpus: 1 } } : {})
};

export default nextConfig;
