FROM node:22.12.0-slim

# Create app directory
WORKDIR /app

# Install OpenSSL (Prisma requires it for correct operation)
RUN apt-get update -y && apt-get install -y openssl

# Copy package.json and package-lock.json
COPY package*.json /app

# Install app dependencies
RUN npm install

# Bundle app source
COPY . .

# Start the app
CMD ["sh", "-c", "npm run build && npm start"]
