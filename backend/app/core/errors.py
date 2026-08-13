"""Safe RFC 7807-style problem responses."""

from http import HTTPStatus

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


PROBLEM_BASE = "https://retention-workbench.local/problems"


class DomainError(Exception):
    """Safe, stable error raised by a domain service."""

    def __init__(self, code: str, status: int, detail: str) -> None:
        super().__init__(detail)
        self.code = code
        self.status = status
        self.detail = detail


def problem_response(
    request: Request,
    *,
    status: int,
    code: str,
    title: str,
    detail: str,
    errors: list[dict[str, object]] | None = None,
) -> JSONResponse:
    correlation_id = getattr(request.state, "correlation_id", "unavailable")
    content = {
        "type": f"{PROBLEM_BASE}/{code.replace('_', '-')}",
        "title": title,
        "status": status,
        "detail": detail,
        "code": code,
        "correlation_id": correlation_id,
    }
    if errors:
        content["errors"] = errors
    return JSONResponse(
        status_code=status,
        media_type="application/problem+json",
        content=content,
    )


async def http_exception_handler(
    request: Request, exception: StarletteHTTPException
) -> JSONResponse:
    if exception.status_code == 404:
        return problem_response(
            request,
            status=404,
            code="not_found",
            title="Resource not found",
            detail="The requested resource does not exist.",
        )
    if exception.status_code == 405:
        return problem_response(
            request,
            status=405,
            code="method_not_allowed",
            title="Method not allowed",
            detail="This route does not support the requested method.",
        )

    title = HTTPStatus(exception.status_code).phrase
    return problem_response(
        request,
        status=exception.status_code,
        code="invalid_request",
        title=title,
        detail="The request could not be completed.",
    )


async def validation_exception_handler(
    request: Request, exception: RequestValidationError
) -> JSONResponse:
    del exception
    return problem_response(
        request,
        status=422,
        code="validation_failed",
        title="Request validation failed",
        detail="One or more fields need correction.",
    )


async def unexpected_exception_handler(
    request: Request, exception: Exception
) -> JSONResponse:
    request.app.state.logger.error(
        "unexpected_request_error",
        extra={"safe_event": "unexpected_request_error"},
    )
    del exception
    return problem_response(
        request,
        status=500,
        code="internal_error",
        title="Internal server error",
        detail="The server could not complete the request.",
    )


async def domain_exception_handler(request: Request, exception: DomainError) -> JSONResponse:
    return problem_response(
        request,
        status=exception.status,
        code=exception.code,
        title="Request could not be completed",
        detail=exception.detail,
    )
