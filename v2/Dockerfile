FROM php:8.3-apache

# SQLite driver + Apache modules
RUN apt-get update && apt-get install -y --no-install-recommends libsqlite3-dev libcurl4-openssl-dev \
    && docker-php-ext-install pdo_sqlite curl \
    && a2enmod rewrite headers \
    && rm -rf /var/lib/apt/lists/*

# App code (docroot = backend/public)
COPY backend /var/www/vortex
RUN sed -i 's|/var/www/html|/var/www/vortex/public|g' /etc/apache2/sites-available/000-default.conf \
    && mkdir -p /var/www/storage/uploads \
    && chown -R www-data:www-data /var/www/storage

ENV STORAGE_DIR=/var/www/storage
ENV APP_DEBUG=0

EXPOSE 80

# Render injects $PORT — make Apache listen on it.
# mkdir+chown در زمان اجرا تا دیسک دائمی Render هم توسط www-data قابل نوشتن باشد.
CMD mkdir -p /var/www/storage && chown -R www-data:www-data /var/www/storage \
    && sed -i "s/Listen 80/Listen ${PORT:-80}/" /etc/apache2/ports.conf \
    && apache2-foreground
