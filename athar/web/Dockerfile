# Build context is the athar/ folder (the app imports the compiled contracts from ../build and ../lib).
FROM node:22-alpine AS build
WORKDIR /app/athar
COPY build ./build
COPY lib ./lib
COPY web ./web
WORKDIR /app/athar/web
RUN npm ci --legacy-peer-deps
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_ATHAR_ADMIN
ARG NEXT_PUBLIC_ATHAR_META_BASE=
ARG NEXT_PUBLIC_TON_NETWORK=mainnet
ARG NEXT_PUBLIC_ATHAR_DELAY_SEC=172800
ENV NEXT_PUBLIC_ATHAR_META_BASE=$NEXT_PUBLIC_ATHAR_META_BASE NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL NEXT_PUBLIC_ATHAR_ADMIN=$NEXT_PUBLIC_ATHAR_ADMIN NEXT_PUBLIC_TON_NETWORK=$NEXT_PUBLIC_TON_NETWORK NEXT_PUBLIC_ATHAR_DELAY_SEC=$NEXT_PUBLIC_ATHAR_DELAY_SEC
RUN npx next build --webpack

FROM node:22-alpine
WORKDIR /app/athar/web
# fonts for the still PNG pictures (link previews, directories): the pictures have texts
RUN apk add --no-cache fontconfig ttf-dejavu
ENV NODE_ENV=production PORT=3100 HOSTNAME=0.0.0.0
COPY --from=build /app/athar/web/.next ./.next
COPY --from=build /app/athar/web/node_modules ./node_modules
COPY --from=build /app/athar/web/package.json ./package.json
COPY --from=build /app/athar/web/next.config.mjs ./next.config.mjs
COPY --from=build /app/athar/web/special ./special
EXPOSE 3100
CMD ["npx", "next", "start", "-p", "3100"]
