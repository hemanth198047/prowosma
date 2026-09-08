# Enables the STOMP plugin on top of the official RabbitMQ image — needed
# for Spring's enableStompBrokerRelay (see WebSocketConfig) to have
# something to actually connect to. The official rabbitmq image doesn't
# have STOMP enabled by default; this is the standard, documented way to
# add it (baking the plugin-enable step into the image at build time),
# rather than overriding the base image's own entrypoint/command, which
# risks skipping other init logic that entrypoint handles.
FROM rabbitmq:4.2.3-management

RUN rabbitmq-plugins enable --offline rabbitmq_stomp

# 5672  = AMQP (RabbitMQ's native protocol, also used by the management UI)
# 15672 = management UI
# 61613 = STOMP — the port this project's WebSocketConfig actually connects to
EXPOSE 5672 15672 61613
