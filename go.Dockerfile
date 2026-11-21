# Imagen de los servicios Go (Incident Service y los Event Consumers).
# Uso: docker build -f go.Dockerfile --build-arg SERVICE=services/incident-service .
FROM golang:1.23-alpine AS build
WORKDIR /src
ENV CGO_ENABLED=0 GOFLAGS=-mod=mod
COPY go.mod go.sum* ./
COPY pkg ./pkg
COPY services/incident-service ./services/incident-service
COPY consumers ./consumers
# go mod tidy completa go.sum la primera vez (requiere internet en el build)
RUN go mod tidy && go mod download
ARG SERVICE
RUN go build -trimpath -ldflags="-s -w" -o /out/app ./${SERVICE}

# Imagen final mínima, sin shell y sin usuario root
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/app /app
USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["/app"]
