(function () {
  'use strict';

  var SIGNALR_SEP = '\x1e';
  var _pending = [];
  var _wsUrlTemplate = null;
  var _modelTone = 'Gpt_5_5_Chat';

  var VARIANTS = [
    'EnableMcpServerWidgets','feature.EnableMcpServerWidgets','feature.EnableLuForChatCIQ',
    'feature.enableChatCIQPlugin','EnableRequestPlugins','feature.EnableSensitivityLabels',
    'EnableUnsupportedUrlDetector','feature.IsCustomEngineCopilotEnabled','feature.bizchatfluxv3',
    'feature.enablechatpages','feature.enableCodeCanvas','feature.turnOnWorkTabRecommendation',
    'feature.turnOnDARecommendation','feature.IsStreamingModeInChatRequestEnabled',
    'IncludeSourceAttributionsConcise','SkipPublishEmptyMessage',
    'feature.EnableDeduplicatingSourceAttributions','Enable3PActionProgressMessages',
    'feature.enableClientWebRtc','feature.EnableMeetingRecapOfSeriesMeetingWithCiq',
    'feature.EnableReferencesListCompleteSignal','feature.StorageMessageSplitDisabled',
    'feature.EnableCuaTakeControlApi','SingletonEnvOn','feature.cwcallowedos',
    'feature.EnableMergingPureDeltas','feature.disabledisallowedmsgs',
    'feature.enableCitationsForSynthesisData','feature.EnableConversationShareApis',
    'feature.enableGenerateGraphicArtOptionsSet','cdximagen',
    'feature.EnableUpdatedUXForConfirmationDialog','feature.EnableContentApiandDocTypeHtmlInRichAnswers',
    'cdxgrounding_api_v2_rich_web_answers_reference_bottom_force','cdxenablerenderforisocomp',
    'feature.EnableClientFileURLSupportForOfficeWebPaidCopilot','feature.EnableDesignEditorImageGrounding',
    'feature.EnableDesignerEditor','feature.EnableSkipRehydrationForSpeCIdImages',
    'feature.EnableSkipEmittingMessageOnFlush','feature.EnableRemoveEmptySourceAttributions',
    'feature.EnableRemoveStreamingMode','feature.OfficeWebToHelix','feature.OfficeDesktopToHelix',
    'feature.M365TeamsHubToHelix','feature.OwaHubToHelix','feature.MonarchHubToHelix',
    'feature.Win32OutlookHubToHelix','feature.MacOutlookHubToHelix','Agt_bizchat_enableGpt5ForHelix',
  ];

  var OPTIONS_SETS = [
    'at_mention_plugins_enable','enable_confirmation_interstitial','enable_plugin_auth_interstitial',
    'enable_request_response_interstitials','enable_response_action_processing',
    'enterprise_flux_image','enterprise_flux_web','enterprise_flux_work',
    'enterprise_toolbox_with_skdsstore','enterprise_pagination_support',
    'search_result_progress_messages_with_search_queries',
    'flux_v3_gptv_enable_upload_multi_image_in_turn_wo_ch','gptvnorm2048',
    'enterprise_flux_work_code_interpreter','cwc_code_interpreter_citation_fix',
    'code_interpreter_interactive_charts','enterprise_code_interpreter_citation_fix',
    'cwc_code_interpreter_interactive_charts_inline_image','code_interpreter_matplotlib_patching',
    'enable_batch_token_processing','disable_cea_message_listener','enable_selective_url_redaction',
    'update_memory_plugin','add_custom_instructions','agent_recommendations','enable_gg_gpt',
    'enable_inferred_memory_read','flux_v3_image_gen_enable_dimensions',
    'flux_v3_image_gen_enable_icon_dimensions','flux_v3_image_gen_enable_system_text_with_params',
    'flux_v3_image_gen_enable_designer_dimensions_meta_prompting_in_system_prompts',
  ];

  var ALLOWED_MESSAGE_TYPES = [
    'Chat','Suggestion','InternalSearchQuery','Disengaged','InternalLoaderMessage',
    'Progress','GeneratedCode','RenderCardRequest','AdsQuery','SemanticSerp',
    'GenerateContentQuery','GenerateGraphicArt','SearchQuery','ConfirmationCard',
    'AuthError','DeveloperLogs','TriggerPlugin','HintInvocation','MemoryUpdate',
    'EndOfRequest','TriggerConfirmation','ResumeInvokeAction','ResumeUserInputRequest',
    'TriggerUserInputRequest','EscapeHatch','TriggerPluginAuth','ResumePluginAuth',
    'SideBySide','ReferencesListComplete','SwitchRespondingEndpoint',
  ];

  function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c){
      var r=Math.random()*16|0; return (c==='x'?r:(r&0x3|0x8)).toString(16);
    });
  }

  // Intercept WebSocket constructor to capture substrate URL template
  var _OrigWS = window.WebSocket;
  window.WebSocket = function(url, protocols) {
    var u = String(url || '');
    if (u.indexOf('substrate.office.com') !== -1 && u.indexOf('access_token=') !== -1) {
      _wsUrlTemplate = u;
    }
    return new _OrigWS(url, protocols);
  };
  window.WebSocket.prototype = _OrigWS.prototype;
  window.WebSocket.CONNECTING = _OrigWS.CONNECTING;
  window.WebSocket.OPEN = _OrigWS.OPEN;
  window.WebSocket.CLOSING = _OrigWS.CLOSING;
  window.WebSocket.CLOSED = _OrigWS.CLOSED;

  function buildWsUrl(convId, sessionId, reqId) {
    if (!_wsUrlTemplate) return null;
    try {
      var u = new URL(_wsUrlTemplate);
      u.searchParams.set('ClientRequestId', reqId);
      u.searchParams.set('X-SessionId', sessionId);
      u.searchParams.set('ConversationId', convId);
      return u.toString();
    } catch (e) {
      return _wsUrlTemplate
        .replace(/ClientRequestId=[^&]+/, 'ClientRequestId=' + reqId)
        .replace(/X-SessionId=[^&]+/, 'X-SessionId=' + sessionId)
        .replace(/ConversationId=[^&]+/, 'ConversationId=' + convId);
    }
  }

  function buildChatInvoke(text, convId, sessionId, reqId) {
    return JSON.stringify({
      arguments: [{
        source: 'officeweb', clientCorrelationId: reqId,
        sessionId: sessionId, optionsSets: OPTIONS_SETS,
        streamingMode: 'ConciseWithPadding', spokenTextMode: 'None',
        options: {}, extraExtensionParameters: {},
        allowedMessageTypes: ALLOWED_MESSAGE_TYPES,
        sliceIds: [], threadLevelGptId: {},
        traceId: reqId, isStartOfSession: true,
        clientInfo: {
          clientPlatform: 'mcmcopilot-web', clientAppName: 'Office',
          clientEntrypoint: 'mcmcopilot-officeweb', clientSessionId: sessionId,
          clientAppType: 'Web', deviceOS: 'Windows', deviceType: 'Desktop',
          ProductCategory: 'Chat', productEntryPoint: 'ChatPanel',
        },
        message: {
          author: 'user', inputMethod: 'Keyboard', text: text,
          entityAnnotationTypes: ['People','File','Event','Email','TeamsMessage'],
          requestId: reqId,
          locationInfo: { timeZoneOffset: 0, timeZone: 'UTC' },
          locale: 'en-us', messageType: 'Chat', experienceType: 'Default',
          adaptiveCards: [], clientPreferences: {},
        },
        plugins: [{ Id: 'BingWebSearch', Source: 'BuiltIn' }],
        isSbsSupported: true,
        tone: _modelTone,
        renderReferencesBehindEOS: true,
      }],
      invocationId: '0', target: 'chat', type: 4,
    }) + SIGNALR_SEP;
  }

  window.__m365Send = function(text) {
    if (!_wsUrlTemplate) {
      _pending.push({ type: 'error', message: 'Not authenticated. Sign in to M365 first.' });
      return;
    }

    var convId = uuid();
    var sessionId = uuid();
    var reqId = uuid();
    var url = buildWsUrl(convId, sessionId, reqId);
    if (!url) return;

    var ws = new _OrigWS(url);
    var handshakeDone = false;

    ws.onopen = function() {
      ws.send(JSON.stringify({ protocol: 'json', version: 1 }) + SIGNALR_SEP);
    };

    ws.onmessage = function(evt) {
      var raw = evt.data || '';
      var parts = raw.split(SIGNALR_SEP);
      for (var i = 0; i < parts.length; i++) {
        var part = parts[i].trim();
        if (!part) continue;

        if (!handshakeDone) {
          handshakeDone = true;
          ws.send(buildChatInvoke(text, convId, sessionId, reqId));
          continue;
        }

        var msg;
        try { msg = JSON.parse(part); } catch (e) { continue; }

        var t = msg.type;
        if (t === 6) continue;

        if (t === 1 && msg.target === 'update') {
          var args = (msg.arguments || [{}])[0];
          var delta = args.writeAtCursor;
          if (delta) _pending.push({ type: 'delta', text: delta });
        }

        if (t === 2) {
          var ims = (msg.item || {}).messages || [];
          for (var k = ims.length - 1; k >= 0; k--) {
            if (ims[k].author !== 'user' && ims[k].text) {
              _pending.push({
                type: 'message',
                text: ims[k].text,
                conversationId: msg.item.conversationId || convId,
                turnState: msg.item.turnState,
              });
              break;
            }
          }
        }

        if (t === 3) {
          _pending.push({ type: 'done', conversationId: convId });
          if (ws.readyState === 1) ws.close();
        }
      }
    };

    ws.onerror = function() {
      _pending.push({ type: 'error', message: 'Substrate connection error' });
    };

    ws.onclose = function() {};
  };

  window.__m365Poll = function() {
    if (!_pending.length) return [];
    var batch = _pending.slice();
    _pending = [];
    return batch;
  };

  window.__m365Ready = function() {
    return !!_wsUrlTemplate;
  };

  window.__m365SetModel = function(model) {
    if (model === 'gpt-5.5-think-deeper') _modelTone = 'Gpt_5_5_Reasoning';
    else if (model === 'gpt-5.5-quick') _modelTone = 'Gpt_5_5_Chat';
    else _modelTone = 'Gpt_5_5_Chat';
  };
})();
