FROM golang:1.23-bookworm

RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs ffmpeg && \
    rm -rf /var/lib/apt/lists/*

RUN go install github.com/air-verse/air@v1.61.7

RUN curl -sSfL https://raw.githubusercontent.com/golangci/golangci-lint/master/install.sh | sh -s -- -b /usr/local/bin v1.62.2

WORKDIR /app

COPY backend/go.mod backend/go.sum* /app/backend/
RUN cd /app/backend && go mod tidy && go mod download

COPY frontend/package.json frontend/package-lock.json* /app/frontend/
RUN cd /app/frontend && npm install

COPY . /app

RUN chmod +x /app/start.sh

EXPOSE 3002

CMD ["/app/start.sh"]
