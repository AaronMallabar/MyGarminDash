from flask import Blueprint

newspaper_bp = Blueprint(
    "newspaper",
    __name__,
    url_prefix="/newspaper",
    template_folder="templates",
    static_folder="static",
)

from . import routes  # noqa: E402, F401
