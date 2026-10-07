-- Vídeo dos pratos.
-- Com Mux: o painel envia direto para o Mux; guardamos o id do envio até o
-- vídeo ficar pronto (aí entram asset e playback id e o status vira 'ready').
-- Sem Mux configurado: o arquivo vai para o bucket "media", como as fotos.
alter table public.media add column mux_upload_id text;

update storage.buckets
set file_size_limit = 52428800,
    allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm']
where id = 'media';
