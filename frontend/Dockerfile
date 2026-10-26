FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
# The user guide the Help page bundles (compose mounts it over this in development).
COPY --from=userdocs . /docs/user
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
