FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /workspace

RUN apt-get update && apt-get install -y --no-install-recommends \
  build-essential \
  curl \
  libpq-dev \
  && rm -rf /var/lib/apt/lists/*

COPY apps/api /workspace/apps/api
RUN pip install --upgrade pip && pip install -e /workspace/apps/api \
  && python -m playwright install --with-deps chromium

WORKDIR /workspace/apps/api
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
