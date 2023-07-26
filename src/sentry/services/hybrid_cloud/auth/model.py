# Please do not use
#     from __future__ import annotations
# in modules such as this one where hybrid cloud data models or service classes are
# defined, because we want to reflect on type annotations and avoid forward references.

import base64
import contextlib
from enum import IntEnum
from typing import (
    TYPE_CHECKING,
    Any,
    Dict,
    Generator,
    List,
    Mapping,
    Optional,
    Set,
    Tuple,
    Type,
    Union,
)

from django.contrib.sessions.backends.base import SessionBase
from pydantic.fields import Field
from rest_framework.authentication import BaseAuthentication
from rest_framework.request import Request

from sentry.relay.utils import get_header_relay_id, get_header_relay_signature
from sentry.services.hybrid_cloud import RpcModel
from sentry.services.hybrid_cloud.user import RpcUser

if TYPE_CHECKING:
    from django.contrib.auth.models import AnonymousUser


class RpcAuthenticatorType(IntEnum):
    API_KEY_AUTHENTICATION = 0
    TOKEN_AUTHENTICATION = 1
    SESSION_AUTHENTICATION = 2
    ORG_AUTH_TOKEN_AUTHENTICATION = 3

    @classmethod
    def from_authenticator(
        self, auth: Type[BaseAuthentication]
    ) -> Optional["RpcAuthenticatorType"]:
        from sentry.api.authentication import (
            ApiKeyAuthentication,
            OrgAuthTokenAuthentication,
            TokenAuthentication,
        )

        if auth == ApiKeyAuthentication:
            return RpcAuthenticatorType.API_KEY_AUTHENTICATION
        if auth == TokenAuthentication:
            return RpcAuthenticatorType.TOKEN_AUTHENTICATION
        if auth == OrgAuthTokenAuthentication:
            return RpcAuthenticatorType.ORG_AUTH_TOKEN_AUTHENTICATION
        return None

    def as_authenticator(self) -> BaseAuthentication:
        from sentry.api.authentication import (
            ApiKeyAuthentication,
            OrgAuthTokenAuthentication,
            TokenAuthentication,
        )

        if self == self.API_KEY_AUTHENTICATION:
            return ApiKeyAuthentication()
        if self == self.TOKEN_AUTHENTICATION:
            return TokenAuthentication()
        if self == self.ORG_AUTH_TOKEN_AUTHENTICATION:
            return OrgAuthTokenAuthentication()
        else:
            raise ValueError(f"{self!r} has not authenticator associated with it.")


def _normalize_to_b64(input: Optional[Union[str, bytes]]) -> Optional[str]:
    if input is None:
        return None
    if isinstance(input, str):
        input = input.encode("utf8")
    return base64.b64encode(input).decode("utf8")


class RpcAuthentication(BaseAuthentication):
    www_authenticate_realm = "api"
    types: List[RpcAuthenticatorType]

    def __init__(self, types: List[RpcAuthenticatorType]):
        self.types = types

    def authenticate(self, request: Request) -> Optional[Tuple[Any, Any]]:
        from django.contrib.auth.models import AnonymousUser

        from sentry.models.apikey import is_api_key_auth
        from sentry.models.orgauthtoken import is_org_auth_token_auth
        from sentry.services.hybrid_cloud.auth.service import auth_service

        response = auth_service.authenticate_with(
            request=authentication_request_from(request), authenticator_types=self.types
        )

        if response.user is not None:
            return response.user, response.auth

        if response.auth is not None and (
            is_api_key_auth(response.auth) or is_org_auth_token_auth(response.auth)
        ):
            return AnonymousUser(), response.auth

        return None

    # What does this do you may ask?  Actually, it tricks the django request_framework to returning the correct 401
    # over 403 in unauthenticated cases, due to some deep library code nonsense.  Tests fail if you remove.
    # Otherwise, this authenticate header value means absolutely nothing to clients.
    def authenticate_header(self, request: Request) -> str:
        return 'xBasic realm="%s"' % self.www_authenticate_realm


class RpcMemberSsoState(RpcModel):
    is_required: bool = False
    is_valid: bool = False


class RpcAuthState(RpcModel):
    sso_state: RpcMemberSsoState
    permissions: List[str]


class AuthenticationRequest(RpcModel):
    # HTTP_X_SENTRY_RELAY_ID
    sentry_relay_id: Optional[str] = None
    # HTTP_X_SENTRY_RELAY_SIGNATURE
    sentry_relay_signature: Optional[str] = None
    backend: Optional[str] = None
    user_id: Optional[str] = None
    user_hash: Optional[str] = None
    nonce: Optional[str] = None

    remote_addr: Optional[str] = None
    signature: Optional[str] = None
    absolute_url: str = ""
    absolute_url_root: str = ""
    path: str = ""
    authorization_b64: Optional[str] = None

    @classmethod
    def get_attributes_of_session_keys(cls) -> Mapping[str, Any]:
        return dict(
            backend="_auth_user_backend",
            user_id="_auth_user_id",
            user_hash="_auth_user_hash",
            nonce="_nonce",
        )

    def apply_from_session(self, session: SessionBase) -> "AuthenticationRequest":
        """
        Copies over attributes from session without changing the existing value for session.accessed
        Modifies self in place and returns it.
        """
        orig = session.accessed
        for attr, session_key in self.get_attributes_of_session_keys().items():
            setattr(self, attr, session.get(session_key, None))
        session.accessed = orig
        return self


def authentication_request_from(request: Request) -> AuthenticationRequest:
    from sentry.utils.linksign import find_signature

    return AuthenticationRequest(
        sentry_relay_id=get_header_relay_id(request),
        sentry_relay_signature=get_header_relay_signature(request),
        remote_addr=request.META["REMOTE_ADDR"],
        signature=find_signature(request),
        absolute_url=request.build_absolute_uri(),
        absolute_url_root=request.build_absolute_uri("/"),
        path=request.path,
        authorization_b64=_normalize_to_b64(request.META.get("HTTP_AUTHORIZATION")),
    ).apply_from_session(request.session)


class AuthenticatedToken(RpcModel):
    allowed_origins: List[str] = Field(default_factory=list)
    audit_log_data: Dict[str, Any] = Field(default_factory=dict)
    scopes: List[str] = Field(default_factory=list)
    entity_id: Optional[int] = None
    kind: str = "system"
    user_id: Optional[int] = None  # only relevant for ApiToken
    organization_id: Optional[int] = None
    application_id: Optional[int] = None  # only relevant for ApiToken

    @classmethod
    def from_token(cls, token: Any) -> Optional["AuthenticatedToken"]:
        if token is None:
            return None

        if isinstance(token, AuthenticatedToken):
            return token

        for kind, kind_cls in cls.get_kinds().items():
            if isinstance(token, kind_cls):
                break
        else:
            raise KeyError(f"Token {token} is a not a registered AuthenticatedToken type!")

        return cls(
            allowed_origins=token.get_allowed_origins(),
            scopes=token.get_scopes(),
            audit_log_data=token.get_audit_log_data(),
            entity_id=getattr(token, "id", None),
            kind=kind,
            user_id=getattr(token, "user_id", None),
            organization_id=getattr(token, "organization_id", None),
            application_id=getattr(token, "application_id", None),
        )

    @classmethod
    def get_kinds(cls) -> Mapping[str, Type[Any]]:
        return getattr(cls, "_kinds", {})

    @classmethod
    def register_kind(cls, kind_name: str, t: Type[Any]) -> None:
        kind_map = getattr(cls, "_kinds", {})
        if kind_name in kind_map:
            raise ValueError(f"Conflict detected, kind {kind_name} registered twice!")
        kind_map[kind_name] = t
        setattr(cls, "_kinds", kind_map)

    def get_audit_log_data(self) -> Mapping[str, Any]:
        return self.audit_log_data

    def get_allowed_origins(self) -> List[str]:
        return self.allowed_origins

    def get_scopes(self) -> List[str]:
        return self.scopes

    def has_scope(self, scope: str) -> bool:
        if self.kind == "system":
            return True
        return scope in self.get_scopes()


class AuthenticationContext(RpcModel):
    """
    The default of all values should be a valid, non authenticated context.
    """

    auth: Optional[AuthenticatedToken] = None
    user: Optional[RpcUser] = None

    def _get_user(self) -> Union[RpcUser, "AnonymousUser"]:
        """
        Helper function to avoid importing AnonymousUser when `applied_to_request` is run on startup
        """
        from django.contrib.auth.models import AnonymousUser

        return self.user or AnonymousUser()

    @contextlib.contextmanager
    def applied_to_request(self, request: Any = None) -> Generator[Any, None, None]:
        """
        Some code still reaches for the global 'env' object when determining user or auth behaviors.  This bleeds the
        current request context into that code, but makes it difficult to carry RPC authentication context in an
        isolated, controlled way.  This method allows for a context handling an RPC or inter silo behavior to assume
        the correct user and auth context provided explicitly in a context.
        """
        from sentry.app import env

        if request is None:
            request = env.request

        if request is None:
            # Contexts that lack a request
            # Note -- if a request is setup in the env after this context manager, you run the risk of bugs.
            yield request
            return

        has_user = hasattr(request, "user")
        has_auth = hasattr(request, "auth")

        old_user = getattr(request, "user", None)
        old_auth = getattr(request, "auth", None)
        request.user = self._get_user()
        request.auth = self.auth

        try:
            yield request
        finally:
            if has_user:
                request.user = old_user
            else:
                delattr(request, "user")

            if has_auth:
                request.auth = old_auth
            else:
                delattr(request, "auth")


class MiddlewareAuthenticationResponse(AuthenticationContext):
    expired: bool = False
    user_from_signed_request: bool = False
    accessed: Set[str] = Field(default_factory=set)


class RpcAuthProviderFlags(RpcModel):
    allow_unlinked: bool = False
    scim_enabled: bool = False


class RpcAuthProvider(RpcModel):
    id: int = -1
    organization_id: int = -1
    provider: str = ""
    flags: RpcAuthProviderFlags = Field(default_factory=lambda: RpcAuthProviderFlags())
    config: Mapping[str, Any]

    def __hash__(self) -> int:
        return hash((self.id, self.organization_id, self.provider))

    def get_audit_log_data(self):
        return {"provider": self.provider, "config": self.config}

    def get_provider(self):
        from sentry.auth import manager

        return manager.get(self.provider, **self.config)


class RpcAuthIdentity(RpcModel):
    id: int = -1
    user_id: int = -1
    provider_id: int = -1
    ident: str = ""


class RpcOrganizationAuthConfig(RpcModel):
    organization_id: int = -1
    auth_provider: Optional[RpcAuthProvider] = None
    has_api_key: bool = False