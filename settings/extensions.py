from flask_sqlalchemy import SQLAlchemy
from flask_caching import Cache
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_mail import Mail
from minio import Minio
import redis
import logging

# Inicializar extensiones
db = SQLAlchemy()
cache = Cache()
mail = Mail()

# Configuración de logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Limiter para rate limiting
limiter = Limiter(
    key_func=get_remote_address,
    default_limits=["500/day", "100/hour"]
)

# Cliente Redis
redis_client = redis.Redis(
    host='localhost',
    port=6379,
    db=1,
    decode_responses=True
)

# Cliente Minio
minio_client = Minio(
    'localhost:9500',
    access_key='minioadmin',
    secret_key='minioadmin',
    secure=False
)