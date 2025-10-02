FROM python:3.12-slim

WORKDIR /app

# Install litellm
RUN pip install --no-cache-dir 'litellm[proxy]'

# Add custom config
COPY ./bytebot-llm-proxy/litellm-config.yaml /app/config.yaml

# Expose port
EXPOSE 4000

# Run litellm proxy
CMD ["litellm", "--config", "/app/config.yaml", "--port", "4000"]
