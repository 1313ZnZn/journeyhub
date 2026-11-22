FROM python:3.12-slim
WORKDIR /app
RUN --mount=type=secret,id=ca_bundle \
    if [ -f /run/secrets/ca_bundle ]; then export PIP_CERT=/run/secrets/ca_bundle; fi; \
    pip install --no-cache-dir uv==0.13.9
COPY pyproject.toml uv.lock ./
RUN --mount=type=secret,id=ca_bundle \
    if [ -f /run/secrets/ca_bundle ]; then export SSL_CERT_FILE=/run/secrets/ca_bundle; fi; \
    uv sync --frozen --no-dev
COPY --chown=10001:10001 journeyhub_agent ./journeyhub_agent
RUN useradd --uid 10001 --no-create-home app
USER app
EXPOSE 8000
CMD [".venv/bin/uvicorn", "journeyhub_agent.app:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
