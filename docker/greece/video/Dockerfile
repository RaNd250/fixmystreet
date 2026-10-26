# Video service for FixMyStreets reports (app.py): checks an uploaded clip and re-encodes it to a
# small H.264 file. Only ffmpeg and Python's standard library; no models, nothing fetched at run time.
FROM debian:bookworm-slim
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg python3 && \
    rm -rf /var/lib/apt/lists/*
RUN useradd --uid 1000 --create-home fmsvideo
WORKDIR /app
COPY app.py .
USER fmsvideo
EXPOSE 8080
CMD ["python3", "app.py"]
