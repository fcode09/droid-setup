import java.lang.reflect.*;

public final class DroidUi {
  static int count;
  static StringBuilder output = new StringBuilder();
  static Object invoke(Object o, String name) throws Exception { return o.getClass().getMethod(name).invoke(o); }
  static Object invoke(Object o, String name, Class<?> type, Object arg) throws Exception { return o.getClass().getMethod(name,type).invoke(o,arg); }
  static String value(Object o, String name) throws Exception { Object v=invoke(o,name); return v==null?"":v.toString(); }
  static String xml(String s) { return s.replace("&","&amp;").replace("\"","&quot;").replace("<","&lt;").replace(">","&gt;").replace("\n","&#10;").replace("\r",""); }
  static void dump(Object n,int depth) throws Exception {
    if(n==null || depth>50 || ++count>1500 || output.length()>700000) return;
    if(Boolean.TRUE.equals(invoke(n,"isPassword")) || !Boolean.TRUE.equals(invoke(n,"isVisibleToUser"))) return;
    output.append("<node text=\"").append(xml(value(n,"getText"))).append("\" desc=\"").append(xml(value(n,"getContentDescription"))).append("\" id=\"").append(xml(value(n,"getViewIdResourceName"))).append("\" clickable=\"").append(invoke(n,"isClickable")).append("\">");
    int total=(Integer)invoke(n,"getChildCount");
    for(int i=0;i<total;i++) dump(invoke(n,"getChild",int.class,i),depth+1);
    output.append("</node>");
  }
  static boolean matches(String text, String mode) {
    String label=text.toLowerCase(java.util.Locale.ROOT).trim();
    if(mode.equals("phone")) return label.equals("phone number") || label.equals("número de teléfono") || label.equals("teléfono (ranura de sim 1)") || label.equals("phone number (sim slot 1)");
    if(mode.equals("imei")) return label.startsWith("imei") && !label.contains("2");
    if(mode.equals("status")) return label.equals("status") || label.equals("estado") || label.equals("estado de sim (ranura de sim 1)") || label.equals("sim status (sim slot 1)");
    if(mode.equals("details")) return label.equals("detailed info and specs") || label.equals("información detallada y especificaciones") || label.equals("status information") || label.equals("información de estado");
    return false;
  }
  static boolean act(Object node,String mode,int depth) throws Exception {
    if(node==null || depth>50 || ++count>1500 || Boolean.TRUE.equals(invoke(node,"isPassword")) || !Boolean.TRUE.equals(invoke(node,"isVisibleToUser"))) return false;
    if(!"com.android.settings".equals(value(node,"getPackageName"))) return false;
    if(mode.equals("scroll") && Boolean.TRUE.equals(invoke(node,"isScrollable"))) return Boolean.TRUE.equals(invoke(node,"performAction",int.class,4096));
    if(matches(value(node,"getText"),mode)) {
      Object target=node;
      for(int i=0;i<4 && target!=null;i++,target=invoke(target,"getParent")) {
        if(!"com.android.settings".equals(value(target,"getPackageName"))) break;
        if(Boolean.TRUE.equals(invoke(target,"isClickable"))) return Boolean.TRUE.equals(invoke(target,"performAction",int.class,16));
      }
    }
    int children=(Integer)invoke(node,"getChildCount");
    for(int i=0;i<children;i++) if(act(invoke(node,"getChild",int.class,i),mode,depth+1)) return true;
    return false;
  }
  public static void main(String[] args) {
    // A host timeout alone cannot terminate a remote app_process. Binder death also
    // releases Android's temporary automation connection if this watchdog fires.
    Thread watchdog=new Thread(new Runnable() { public void run() {
      try { Thread.sleep(4000); } catch(InterruptedException ignored) { return; }
      Runtime.getRuntime().halt(3);
    } }, "droid-setup-deadline");
    watchdog.setDaemon(true); watchdog.start();
    Object automation=null,thread=null;
    try {
      Class<?> handler=Class.forName("android.os.HandlerThread");
      thread=handler.getConstructor(String.class).newInstance("droid-setup-ui");
      ((Thread)thread).start();
      Object looper=invoke(thread,"getLooper");
      Object connection=Class.forName("android.app.UiAutomationConnection").getConstructor().newInstance();
      Class<?> ui=Class.forName("android.app.UiAutomation");
      automation=ui.getConstructor(Class.forName("android.os.Looper"),Class.forName("android.app.IUiAutomationConnection")).newInstance(looper,connection);
      invoke(automation,"connect",int.class,1);
      Object root=null;
      for(int attempt=0; attempt<8; attempt++) { root=invoke(automation,"getRootInActiveWindow"); if(root!=null) break; Thread.sleep(100); }
      String mode=args.length==0?"dump":args[0];
      if(root==null || !"com.android.settings".equals(value(root,"getPackageName"))) { System.out.println("<error code=\"not-settings\" package=\""+(root==null?"null":value(root,"getPackageName"))+"\"/>"); }
      else {
        if(mode.equals("dump")) {
          Object window=invoke(root,"getWindowId");
          output.append("<hierarchy>"); dump(root,0); output.append("</hierarchy>");
          Object current=invoke(automation,"getRootInActiveWindow");
          if(current!=null && "com.android.settings".equals(value(current,"getPackageName")) && window.equals(invoke(current,"getWindowId"))) System.out.println(output);
          else System.out.println("<error code=\"screen-changed\"/>");
        } else if(mode.equals("phone") || mode.equals("imei") || mode.equals("status") || mode.equals("details") || mode.equals("scroll")) {
          System.out.println("<action performed=\""+act(root,mode,0)+"\"/>");
        } else System.out.println("<error code=\"unsupported\"/>");
      }
    } catch(Throwable e) { System.out.println("<error code=\"unavailable\"/>"); }
    finally {
      if(automation!=null) try { invoke(automation,"disconnect"); } catch(Exception ignored) {}
      if(thread!=null) try { invoke(thread,"quitSafely"); } catch(Exception ignored) {}
    }
    System.exit(0);
  }
}
